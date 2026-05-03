// routes/orsRoute.js
const express = require("express");
const axios = require("axios");

const router = express.Router();

const ORS_DIRECTIONS_URL =
  "https://api.openrouteservice.org/v2/directions/driving-car/geojson";

// ======================================================
// CONFIG
// ======================================================

const ROUTE_CACHE_TTL_MS = 1000 * 60 * 10; // 10 minutes
const MAX_QUEUE_SIZE = 150;
const ORS_CONCURRENCY = 2;
const ORS_REQUEST_SPACING_MS = 350;
const ORS_TIMEOUT_MS = 15000;

// If ORS returns 429, skip ORS temporarily instead of hammering it
const RATE_LIMIT_COOLDOWN_MS = 1000 * 60; // 1 minute

// ======================================================
// SIMPLE IN-MEMORY CACHE + QUEUE
// Safe first version. Later we can move important route cache to MongoDB.
// ======================================================

const routeCache = new Map();
const routeQueue = [];
const queuedByReplaceKey = new Map();

let activeOrsRequests = 0;
let lastOrsRequestAt = 0;

const providerState = {
  ors: {
    limitedUntil: 0,
    failCount: 0,
  },
};

function logRoute(message, extra = {}) {
  console.log(`[ROUTING] ${message}`, extra);
}

function now() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

function okLat(x) {
  return isNum(x) && x >= -90 && x <= 90;
}

function okLng(x) {
  return isNum(x) && x >= -180 && x <= 180;
}

function validPair(p) {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    okLng(Number(p[0])) &&
    okLat(Number(p[1]))
  );
}

function normalizePair(p) {
  return [Number(p[0]), Number(p[1])];
}

function validCoords(coords) {
  return (
    Array.isArray(coords) &&
    coords.length >= 2 &&
    coords.every(validPair)
  );
}

function normalizeCoords(coords) {
  return coords.map(normalizePair);
}

function parseQueryPair(s) {
  if (!s || typeof s !== "string") return null;
  const [lngStr, latStr] = s.split(",").map((t) => t.trim());
  const lng = parseFloat(lngStr);
  const lat = parseFloat(latStr);
  return [lng, lat];
}

function roundCoord(n, decimals = 5) {
  return Number(n).toFixed(decimals);
}

function coordsCacheKey(coords, extra = {}) {
  const coordKey = coords
    .map(([lng, lat]) => `${roundCoord(lng)},${roundCoord(lat)}`)
    .join("|");

  const extraKey = Object.keys(extra)
    .sort()
    .map((k) => `${k}:${extra[k]}`)
    .join("|");

  return extraKey ? `${coordKey}::${extraKey}` : coordKey;
}

function getCachedRoute(key) {
  const item = routeCache.get(key);
  if (!item) return null;

  if (now() - item.createdAt > ROUTE_CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }

  return item.data;
}

function setCachedRoute(key, data) {
  routeCache.set(key, {
    createdAt: now(),
    data,
  });
}

function markProviderLimited(provider, reason) {
  providerState[provider].limitedUntil = now() + RATE_LIMIT_COOLDOWN_MS;
  providerState[provider].failCount += 1;

  logRoute(`${provider.toUpperCase()} rate limit reached. Queueing protected requests for now.`, {
    reason,
    limitedUntil: new Date(providerState[provider].limitedUntil).toISOString(),
  });
}

function isProviderLimited(provider) {
  return now() < providerState[provider].limitedUntil;
}

function normalizeOrsGeoJson(data, provider = "ors") {
  const feat = data?.features?.[0];

  if (!feat?.geometry?.coordinates?.length) {
    return null;
  }

  const coordinates = feat.geometry.coordinates;
  const coordsForMap = coordinates.map(([lng, lat]) => [lat, lng]);
  const summary = feat.properties?.summary || {};

  return {
    ok: true,
    provider,
    source: "live",
    geometry: {
      type: "LineString",
      coordinates,
    },
    coordsForMap,
    summary: {
      distance: Number(summary.distance || 0),
      duration: Number(summary.duration || 0),
    },
    raw: data,
  };
}

async function callORSDirections(coords, extraBody = {}) {
  const ORS_KEY = process.env.ORS_API_KEY;

  if (!ORS_KEY) {
    const err = new Error("Server misconfig: ORS_API_KEY missing");
    err.status = 500;
    throw err;
  }

  if (isProviderLimited("ors")) {
    const err = new Error("ORS temporarily rate-limited");
    err.status = 429;
    err.providerLimited = true;
    throw err;
  }

  // spacing to avoid bursts
  const elapsed = now() - lastOrsRequestAt;
  if (elapsed < ORS_REQUEST_SPACING_MS) {
    await sleep(ORS_REQUEST_SPACING_MS - elapsed);
  }

  lastOrsRequestAt = now();

  try {
    const response = await axios.post(
      ORS_DIRECTIONS_URL,
      {
        coordinates: coords,
        ...extraBody,
      },
      {
        headers: {
          Authorization: ORS_KEY,
          "Content-Type": "application/json",
        },
        timeout: ORS_TIMEOUT_MS,
      }
    );

    providerState.ors.failCount = 0;
    return response.data;
  } catch (e) {
    const status = e.response?.status;

    if (status === 429) {
      markProviderLimited("ors", e.response?.data || e.message);
    }

    throw e;
  }
}

function processQueue() {
  if (activeOrsRequests >= ORS_CONCURRENCY) return;
  if (!routeQueue.length) return;

  const job = routeQueue.shift();

  if (job.replaceKey) {
    const currentJobId = queuedByReplaceKey.get(job.replaceKey);
    if (currentJobId === job.jobId) {
      queuedByReplaceKey.delete(job.replaceKey);
    }
  }

  activeOrsRequests += 1;

  (async () => {
    try {
      const result = await job.run();
      job.resolve(result);
    } catch (err) {
      job.reject(err);
    } finally {
      activeOrsRequests -= 1;
      setTimeout(processQueue, ORS_REQUEST_SPACING_MS);
    }
  })();
}

function enqueueRouteJob({
  run,
  priority = 3,
  replaceable = false,
  replaceKey = null,
  label = "route",
}) {
  return new Promise((resolve, reject) => {
    if (routeQueue.length >= MAX_QUEUE_SIZE) {
      const err = new Error("Route queue is full");
      err.status = 503;
      return reject(err);
    }

    const jobId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // Latest request wins for preview/destination tapping
    if (replaceable && replaceKey) {
      const oldJobId = queuedByReplaceKey.get(replaceKey);

      if (oldJobId) {
        const idx = routeQueue.findIndex((j) => j.jobId === oldJobId);
        if (idx >= 0) {
          const [oldJob] = routeQueue.splice(idx, 1);
          oldJob.reject(
            Object.assign(new Error("Replaced by newer route request"), {
              status: 409,
              replaced: true,
            })
          );

          logRoute("Replaced older queued route request with newer one.", {
            replaceKey,
            label,
          });
        }
      }

      queuedByReplaceKey.set(replaceKey, jobId);
    }

    const job = {
      jobId,
      priority,
      replaceable,
      replaceKey,
      label,
      run,
      resolve,
      reject,
      createdAt: now(),
    };

    routeQueue.push(job);
    routeQueue.sort((a, b) => a.priority - b.priority);

    logRoute("Queued route request.", {
      label,
      priority,
      replaceable,
      replaceKey,
      queueSize: routeQueue.length,
    });

    processQueue();
  });
}

async function getDirectionsWithCacheAndQueue({
  coords,
  extraBody = {},
  cacheExtra = {},
  priority = 3,
  replaceable = false,
  replaceKey = null,
  label = "directions",
}) {
  const normalized = normalizeCoords(coords);
  const cacheKey = coordsCacheKey(normalized, cacheExtra);

  const cached = getCachedRoute(cacheKey);
  if (cached) {
    logRoute("Route served from cache.", {
      label,
      cacheKey,
      provider: cached.provider,
    });

    return {
      ...cached,
      source: "cache",
    };
  }

  const result = await enqueueRouteJob({
    priority,
    replaceable,
    replaceKey,
    label,
    run: async () => {
      const data = await callORSDirections(normalized, extraBody);

      const normalizedResult = normalizeOrsGeoJson(data, "ors");

      if (!normalizedResult) {
        const err = new Error("ORS_NO_FEATURES");
        err.status = 502;
        err.details = data;
        throw err;
      }

      setCachedRoute(cacheKey, normalizedResult);

      logRoute("Route served from ORS live request.", {
        label,
        cacheKey,
        distance: normalizedResult.summary.distance,
        duration: normalizedResult.summary.duration,
      });

      return normalizedResult;
    },
  });

  return result;
}

function legacyGeoJsonResponse(normalizedRoute) {
  if (normalizedRoute?.raw?.features?.length) {
    return normalizedRoute.raw;
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          summary: normalizedRoute.summary || {},
          provider: normalizedRoute.provider,
          source: normalizedRoute.source,
        },
        geometry: normalizedRoute.geometry,
      },
    ],
  };
}

function extractCoordsFromBody(req) {
  let coords = null;

  // Keep old route behavior safe: /api/route only uses first 2 points for now.
  // Multi-stop driver-plan will get its own endpoint later.
  if (Array.isArray(req.body?.coordinates) && req.body.coordinates.length >= 2) {
    coords = [req.body.coordinates[0], req.body.coordinates[1]];
  }

  if (!coords && req.body?.start && req.body?.end) {
    coords = [req.body.start, req.body.end];
  }

  if (!validCoords(coords)) return null;

  return normalizeCoords(coords);
}

function getRequestIdentity(req) {
  return (
    req.body?.userId ||
    req.body?.passengerId ||
    req.body?.driverId ||
    req.query?.userId ||
    req.query?.passengerId ||
    req.query?.driverId ||
    req.ip ||
    "anonymous"
  );
}

// ======================================================
// EXISTING ENDPOINTS — preserved
// ======================================================

// POST /api/route
router.post("/api/route", async (req, res) => {
  try {
    const coords = extractCoordsFromBody(req);

    if (!coords) {
      return res.status(400).json({
        error: "INVALID_INPUT",
        details: "Provide valid coordinates or start/end",
      });
    }

    const identity = getRequestIdentity(req);

    const route = await getDirectionsWithCacheAndQueue({
      coords,
      priority: Number(req.body?.priority || 2),
      replaceable: Boolean(req.body?.replaceable || false),
      replaceKey: req.body?.replaceKey || `route:${identity}`,
      label: "POST /api/route",
    });

    return res.json(legacyGeoJsonResponse(route));
  } catch (e) {
    if (e.replaced) {
      return res.status(409).json({
        error: "ROUTE_REQUEST_REPLACED",
        details: e.message,
      });
    }

    console.error("[ROUTING] POST /api/route failed:", e.response?.data || e.details || e.message);

    return res.status(e.response?.status || e.status || 500).json({
      error: "ROUTE_FAILED",
      details: e.response?.data || e.details || e.message,
    });
  }
});

// GET /api/route?start=lng,lat&end=lng,lat
router.get("/api/route", async (req, res) => {
  try {
    const start = parseQueryPair(req.query.start);
    const end = parseQueryPair(req.query.end);

    if (!validPair(start) || !validPair(end)) {
      return res.status(400).json({
        error: "INVALID_QUERY",
        details: "Use ?start=lng,lat&end=lng,lat",
      });
    }

    const coords = [normalizePair(start), normalizePair(end)];

    const route = await getDirectionsWithCacheAndQueue({
      coords,
      priority: 2,
      replaceable: false,
      label: "GET /api/route",
    });

    return res.json(legacyGeoJsonResponse(route));
  } catch (e) {
    console.error("[ROUTING] GET /api/route failed:", e.response?.data || e.details || e.message);

    return res.status(e.response?.status || e.status || 500).json({
      error: "ROUTE_FAILED",
      details: e.response?.data || e.details || e.message,
    });
  }
});

// POST /api/route/variants
router.post("/api/route/variants", async (req, res) => {
  try {
    const { start, end } = req.body || {};

    if (!validPair(start) || !validPair(end)) {
      return res.status(400).json({
        error: "INVALID_INPUT",
        details: "Provide { start:[lng,lat], end:[lng,lat] }",
      });
    }

    const coords = [normalizePair(start), normalizePair(end)];
    const identity = getRequestIdentity(req);

    // ORS supports preferences like recommended, fastest, shortest.
    // Some may return same-looking geometry depending on roads, but this restores the options.
    const prefs = ["recommended", "fastest", "shortest"];

    const results = [];

    for (const pref of prefs) {
      try {
        const route = await getDirectionsWithCacheAndQueue({
          coords,
          extraBody: { preference: pref },
          cacheExtra: { preference: pref },
          priority: Number(req.body?.priority || 4),
          replaceable: Boolean(req.body?.replaceable ?? true),
          replaceKey:
            req.body?.replaceKey ||
            `route-variants:${identity}:${roundCoord(start[0], 4)},${roundCoord(start[1], 4)}:${roundCoord(end[0], 4)},${roundCoord(end[1], 4)}`,
          label: `POST /api/route/variants:${pref}`,
        });

        if (!route?.coordsForMap?.length) continue;

        results.push({
          id: pref,
          preference: pref,
          provider: route.provider,
          source: route.source,
          coords: route.coordsForMap,
          summary: {
            distance: route.summary.distance,
            duration: route.summary.duration,
          },
        });
      } catch (e) {
        if (e.replaced) {
          throw e;
        }

        console.error(
          `[ROUTING] variant ${pref} failed:`,
          e.response?.data || e.details || e.message
        );
      }
    }

    if (!results.length) {
      return res.status(502).json({
        error: "ORS_NO_VARIANTS",
      });
    }

    return res.json(results);
  } catch (e) {
    if (e.replaced) {
      return res.status(409).json({
        error: "ROUTE_REQUEST_REPLACED",
        details: e.message,
      });
    }

    console.error("[ROUTING] variants failed:", e.response?.data || e.details || e.message);

    return res.status(e.response?.status || e.status || 500).json({
      error: "ROUTE_VARIANTS_FAILED",
      details: e.response?.data || e.details || e.message,
    });
  }
});

// ======================================================
// HEALTH / DEBUG ENDPOINT
// ======================================================

router.get("/api/route/status", (req, res) => {
  res.json({
    ok: true,
    providers: {
      ors: {
        limited: isProviderLimited("ors"),
        limitedUntil: providerState.ors.limitedUntil
          ? new Date(providerState.ors.limitedUntil).toISOString()
          : null,
        failCount: providerState.ors.failCount,
      },
    },
    queue: {
      size: routeQueue.length,
      active: activeOrsRequests,
      maxSize: MAX_QUEUE_SIZE,
      concurrency: ORS_CONCURRENCY,
    },
    cache: {
      size: routeCache.size,
      ttlMs: ROUTE_CACHE_TTL_MS,
    },
  });
});

module.exports = router;