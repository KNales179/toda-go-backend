// routes/orsRoute.js
const express = require("express");
const axios = require("axios");

const router = express.Router();

const ORS_DIRECTIONS_URL =
  "https://api.openrouteservice.org/v2/directions/driving-car/geojson";

const ORS_MATRIX_URL =
  "https://api.openrouteservice.org/v2/matrix/driving-car";

const ORS_SNAP_URL =
  "https://api.openrouteservice.org/v2/snap/driving-car";

const GRAPHHOPPER_ROUTE_URL = "https://graphhopper.com/api/1/route";

const TOMTOM_ROUTE_BASE_URL =
  "https://api.tomtom.com/routing/1/calculateRoute";

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
  graphhopper: {
    limitedUntil: 0,
    failCount: 0,
  },
  tomtom: {
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

function getErrorStatus(e) {
  return e?.response?.status || e?.status || 0;
}

function isFallbackWorthyError(e) {
  const status = getErrorStatus(e);

  // 429 = rate limit
  // 5xx = provider/server issue
  // 0 = timeout/network/no response
  return status === 429 || status >= 500 || status === 0;
}

function providerDisplayName(provider) {
  if (provider === "ors") return "ORS";
  if (provider === "graphhopper") return "GraphHopper";
  if (provider === "tomtom") return "TomTom";
  return provider;
}

function normalizeGraphHopperRoute(data) {
  const path = data?.paths?.[0];

  if (!path) return null;

  const coordinates =
    path?.points?.coordinates ||
    path?.points?.features?.[0]?.geometry?.coordinates ||
    [];

  if (!Array.isArray(coordinates) || !coordinates.length) {
    return null;
  }

  const coordsForMap = coordinates.map(([lng, lat]) => [lat, lng]);
  const distance = Number(path.distance || 0);
  const duration = Number(path.time || 0) / 1000;

  return {
    ok: true,
    provider: "graphhopper",
    source: "live",
    geometry: {
      type: "LineString",
      coordinates,
    },
    coordsForMap,
    summary: {
      distance,
      duration,
    },
    raw: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            summary: {
              distance,
              duration,
            },
            provider: "graphhopper",
          },
          geometry: {
            type: "LineString",
            coordinates,
          },
        },
      ],
      metadata: {
        provider: "graphhopper",
      },
    },
  };
}

function normalizeTomTomRoute(data) {
  const route = data?.routes?.[0];

  if (!route?.legs?.length) return null;

  const coordinates = [];

  for (const leg of route.legs) {
    const points = Array.isArray(leg.points) ? leg.points : [];

    for (const p of points) {
      if (
        typeof p?.longitude === "number" &&
        typeof p?.latitude === "number"
      ) {
        coordinates.push([p.longitude, p.latitude]);
      }
    }
  }

  if (!coordinates.length) return null;

  const coordsForMap = coordinates.map(([lng, lat]) => [lat, lng]);
  const summary = route.summary || {};

  const distance = Number(summary.lengthInMeters || 0);
  const duration = Number(summary.travelTimeInSeconds || 0);

  return {
    ok: true,
    provider: "tomtom",
    source: "live",
    geometry: {
      type: "LineString",
      coordinates,
    },
    coordsForMap,
    summary: {
      distance,
      duration,
    },
    raw: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            summary: {
              distance,
              duration,
            },
            provider: "tomtom",
          },
          geometry: {
            type: "LineString",
            coordinates,
          },
        },
      ],
      metadata: {
        provider: "tomtom",
      },
    },
  };
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

async function callGraphHopperDirections(coords) {
  const key = process.env.GRAPHHOPPER_API_KEY;

  if (!key) {
    const err = new Error("GRAPHHOPPER_API_KEY missing");
    err.status = 500;
    err.providerConfigMissing = true;
    throw err;
  }

  if (isProviderLimited("graphhopper")) {
    const err = new Error("GraphHopper temporarily rate-limited");
    err.status = 429;
    err.providerLimited = true;
    throw err;
  }

  const points = coords.map(([lng, lat]) => `${lat},${lng}`);

  try {
    const response = await axios.get(GRAPHHOPPER_ROUTE_URL, {
      params: {
        key,
        vehicle: "car",
        locale: "en",
        points_encoded: false,
        point: points,
      },
      paramsSerializer: (params) => {
        const sp = new URLSearchParams();

        Object.entries(params).forEach(([k, v]) => {
          if (Array.isArray(v)) {
            v.forEach((item) => sp.append(k, item));
          } else {
            sp.append(k, v);
          }
        });

        return sp.toString();
      },
      timeout: ORS_TIMEOUT_MS,
    });

    providerState.graphhopper.failCount = 0;
    return response.data;
  } catch (e) {
    if (e.response?.status === 429) {
      markProviderLimited("graphhopper", e.response?.data || e.message);
    }

    throw e;
  }
}

async function callTomTomDirections(coords) {
  const key = process.env.TOMTOM_API_KEY;

  if (!key) {
    const err = new Error("TOMTOM_API_KEY missing");
    err.status = 500;
    err.providerConfigMissing = true;
    throw err;
  }

  if (isProviderLimited("tomtom")) {
    const err = new Error("TomTom temporarily rate-limited");
    err.status = 429;
    err.providerLimited = true;
    throw err;
  }

  // TomTom format:
  // /calculateRoute/lat,lng:lat,lng/json?key=...
  const routePath = coords.map(([lng, lat]) => `${lat},${lng}`).join(":");
  const url = `${TOMTOM_ROUTE_BASE_URL}/${routePath}/json`;

  try {
    const response = await axios.get(url, {
      params: {
        key,
        routeType: "fastest",
        traffic: false,
        travelMode: "car",
        instructionsType: "text",
        computeBestOrder: false,
        routeRepresentation: "polyline",
      },
      timeout: ORS_TIMEOUT_MS,
    });

    providerState.tomtom.failCount = 0;
    return response.data;
  } catch (e) {
    if (e.response?.status === 429) {
      markProviderLimited("tomtom", e.response?.data || e.message);
    }

    throw e;
  }
}

async function getDirectionsFromBestProvider(coords, extraBody = {}) {
  const debugSkipProviders = Array.isArray(extraBody.debugSkipProviders)
  ? extraBody.debugSkipProviders.map((p) => String(p).toLowerCase())
  : [];
  const providers = [
    {
      name: "ors",
      run: async () => {
        const data = await callORSDirections(coords, extraBody);
        return normalizeOrsGeoJson(data, "ors");
      },
    },
    {
      name: "graphhopper",
      run: async () => {
        // GraphHopper Free has stricter location limits.
        // Keep this guard so bigger driver plans can skip GraphHopper later.
        if (coords.length > 5) {
          const err = new Error("GraphHopper skipped because route has more than 5 points");
          err.status = 422;
          err.skipProvider = true;
          throw err;
        }

        const data = await callGraphHopperDirections(coords);
        return normalizeGraphHopperRoute(data);
      },
    },
    {
      name: "tomtom",
      run: async () => {
        const data = await callTomTomDirections(coords);
        return normalizeTomTomRoute(data);
      },
    },
  ];

  let lastError = null;

  for (const provider of providers) {
    try {
      if (debugSkipProviders.includes(provider.name)) {
        logRoute(`${providerDisplayName(provider.name)} skipped by debugSkipProviders.`, {
          provider: provider.name,
        });
        continue;
      }
      if (isProviderLimited(provider.name)) {
        logRoute(`${providerDisplayName(provider.name)} is currently limited. Skipping provider.`, {
          provider: provider.name,
          limitedUntil: providerState[provider.name]?.limitedUntil
            ? new Date(providerState[provider.name].limitedUntil).toISOString()
            : null,
        });

        continue;
      }

      logRoute(`Trying route provider: ${providerDisplayName(provider.name)}.`);

      const result = await provider.run();

      if (!result?.geometry?.coordinates?.length) {
        const err = new Error(`${providerDisplayName(provider.name)} returned no route geometry`);
        err.status = 502;
        throw err;
      }

      logRoute(`Route provider succeeded: ${providerDisplayName(provider.name)}.`, {
        distance: result.summary?.distance,
        duration: result.summary?.duration,
      });

      return result;
    } catch (e) {
      lastError = e;

      const status = getErrorStatus(e);

      if (e.skipProvider) {
        logRoute(`${providerDisplayName(provider.name)} skipped.`, {
          message: e.message,
        });
        continue;
      }

      if (e.providerConfigMissing) {
        logRoute(`${providerDisplayName(provider.name)} is not configured. Skipping.`, {
          message: e.message,
        });
        continue;
      }

      if (status === 429) {
        markProviderLimited(provider.name, e.response?.data || e.message);

        const nextProvider =
          provider.name === "ors"
            ? "GraphHopper"
            : provider.name === "graphhopper"
              ? "TomTom"
              : "queue";

        logRoute(
          `${providerDisplayName(provider.name)} reached limit. Switching to ${nextProvider}.`,
          { status }
        );

        continue;
      }

      if (isFallbackWorthyError(e)) {
        const nextProvider =
          provider.name === "ors"
            ? "GraphHopper"
            : provider.name === "graphhopper"
              ? "TomTom"
              : "queue";

        logRoute(
          `${providerDisplayName(provider.name)} failed. Switching to ${nextProvider}.`,
          {
            status,
            message: e.response?.data || e.message,
          }
        );

        continue;
      }

      // Bad input errors should not keep trying other providers.
      throw e;
    }
  }

  const err = new Error("All routing providers failed or are currently limited");
  err.status = 503;
  err.details = lastError?.response?.data || lastError?.message || null;
  throw err;
}

async function callORSMatrix(body = {}) {
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

  const elapsed = now() - lastOrsRequestAt;
  if (elapsed < ORS_REQUEST_SPACING_MS) {
    await sleep(ORS_REQUEST_SPACING_MS - elapsed);
  }

  lastOrsRequestAt = now();

  try {
    const response = await axios.post(ORS_MATRIX_URL, body, {
      headers: {
        Authorization: ORS_KEY,
        "Content-Type": "application/json",
      },
      timeout: ORS_TIMEOUT_MS,
    });

    providerState.ors.failCount = 0;
    return response.data;
  } catch (e) {
    if (e.response?.status === 429) {
      markProviderLimited("ors", e.response?.data || e.message);
    }

    throw e;
  }
}

async function callORSSnap(body = {}) {
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

  const elapsed = now() - lastOrsRequestAt;
  if (elapsed < ORS_REQUEST_SPACING_MS) {
    await sleep(ORS_REQUEST_SPACING_MS - elapsed);
  }

  lastOrsRequestAt = now();

  try {
    const response = await axios.post(ORS_SNAP_URL, body, {
      headers: {
        Authorization: ORS_KEY,
        "Content-Type": "application/json",
      },
      timeout: ORS_TIMEOUT_MS,
    });

    providerState.ors.failCount = 0;
    return response.data;
  } catch (e) {
    if (e.response?.status === 429) {
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

  const debugSkipProviders = Array.isArray(extraBody.debugSkipProviders)
    ? extraBody.debugSkipProviders.map((p) => String(p).toLowerCase())
    : [];

  const shouldBypassCache = debugSkipProviders.length > 0;

  const cached = shouldBypassCache ? null : getCachedRoute(cacheKey);

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

  if (shouldBypassCache) {
    logRoute("Cache bypassed for debug provider test.", {
      label,
      cacheKey,
      debugSkipProviders,
    });
  }

  const result = await enqueueRouteJob({
    priority,
    replaceable,
    replaceKey,
    label,
    run: async () => {
      const normalizedResult = await getDirectionsFromBestProvider(normalized, extraBody);

      if (!normalizedResult) {
        const err = new Error("NO_ROUTE_FEATURES");
        err.status = 502;
        throw err;
      }

      setCachedRoute(cacheKey, normalizedResult);

      logRoute("Route served from live provider request.", {
        label,
        provider: normalizedResult.provider,
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
      extraBody: {
        debugSkipProviders: req.body?.debugSkipProviders,
      },
      cacheExtra: {
        debugSkipProviders: Array.isArray(req.body?.debugSkipProviders)
          ? req.body.debugSkipProviders.join(",")
          : "",
      },
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
// ORS MATRIX + SNAP ENDPOINTS
// ======================================================

// POST /api/route/matrix
// Body example:
// {
//   "locations": [[121.61, 13.94], [121.62, 13.95], [121.63, 13.96]],
//   "sources": [0],
//   "destinations": [1, 2],
//   "metrics": ["distance", "duration"]
// }
router.post("/api/route/matrix", async (req, res) => {
  try {
    const {
      locations,
      sources,
      destinations,
      metrics = ["distance", "duration"],
      units = "km",
    } = req.body || {};

    if (!Array.isArray(locations) || locations.length < 2 || !locations.every(validPair)) {
      return res.status(400).json({
        error: "INVALID_INPUT",
        details: "Provide locations as [[lng,lat], [lng,lat], ...]",
      });
    }

    const safeLocations = normalizeCoords(locations).slice(0, 25);

    const body = {
      locations: safeLocations,
      metrics,
      units,
    };

    if (Array.isArray(sources)) body.sources = sources;
    if (Array.isArray(destinations)) body.destinations = destinations;

    const matrix = await enqueueRouteJob({
      priority: Number(req.body?.priority || 3),
      replaceable: Boolean(req.body?.replaceable || false),
      replaceKey: req.body?.replaceKey || null,
      label: "POST /api/route/matrix",
      run: async () => {
        logRoute("ORS Matrix request started.", {
          locations: safeLocations.length,
          sources: body.sources,
          destinations: body.destinations,
        });

        const data = await callORSMatrix(body);

        logRoute("ORS Matrix request completed.", {
          locations: safeLocations.length,
        });

        return {
          ok: true,
          provider: "ors",
          source: "live",
          data,
        };
      },
    });

    return res.json(matrix);
  } catch (e) {
    if (e.replaced) {
      return res.status(409).json({
        error: "MATRIX_REQUEST_REPLACED",
        details: e.message,
      });
    }

    console.error("[ROUTING] matrix failed:", e.response?.data || e.details || e.message);

    return res.status(e.response?.status || e.status || 500).json({
      error: "MATRIX_FAILED",
      details: e.response?.data || e.details || e.message,
    });
  }
});

// POST /api/route/snap
// Body example:
// {
//   "locations": [[121.61, 13.94], [121.62, 13.95]],
//   "radius": 350
// }
router.post("/api/route/snap", async (req, res) => {
  try {
    const { locations, radius = 350 } = req.body || {};

    if (!Array.isArray(locations) || locations.length < 1 || !locations.every(validPair)) {
      return res.status(400).json({
        error: "INVALID_INPUT",
        details: "Provide locations as [[lng,lat], [lng,lat], ...]",
      });
    }

    const safeLocations = normalizeCoords(locations).slice(0, 50);

    const body = {
      locations: safeLocations,
      radius: Number(radius) || 350,
    };

    const snapped = await enqueueRouteJob({
      priority: Number(req.body?.priority || 4),
      replaceable: Boolean(req.body?.replaceable ?? true),
      replaceKey: req.body?.replaceKey || null,
      label: "POST /api/route/snap",
      run: async () => {
        logRoute("ORS Snap request started.", {
          locations: safeLocations.length,
          radius: body.radius,
        });

        const data = await callORSSnap(body);

        logRoute("ORS Snap request completed.", {
          locations: safeLocations.length,
        });

        return {
          ok: true,
          provider: "ors",
          source: "live",
          data,
        };
      },
    });

    return res.json(snapped);
  } catch (e) {
    if (e.replaced) {
      return res.status(409).json({
        error: "SNAP_REQUEST_REPLACED",
        details: e.message,
      });
    }

    console.error("[ROUTING] snap failed:", e.response?.data || e.details || e.message);

    return res.status(e.response?.status || e.status || 500).json({
      error: "SNAP_FAILED",
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
        configured: Boolean(process.env.ORS_API_KEY),
        limited: isProviderLimited("ors"),
        limitedUntil: providerState.ors.limitedUntil
          ? new Date(providerState.ors.limitedUntil).toISOString()
          : null,
        failCount: providerState.ors.failCount,
      },
      graphhopper: {
        configured: Boolean(process.env.GRAPHHOPPER_API_KEY),
        limited: isProviderLimited("graphhopper"),
        limitedUntil: providerState.graphhopper.limitedUntil
          ? new Date(providerState.graphhopper.limitedUntil).toISOString()
          : null,
        failCount: providerState.graphhopper.failCount,
      },
      tomtom: {
        configured: Boolean(process.env.TOMTOM_API_KEY),
        limited: isProviderLimited("tomtom"),
        limitedUntil: providerState.tomtom.limitedUntil
          ? new Date(providerState.tomtom.limitedUntil).toISOString()
          : null,
        failCount: providerState.tomtom.failCount,
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