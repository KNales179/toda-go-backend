// routes/placesRoute.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * ====== CONFIG ======
 * Add these to Render Environment:
 * LOCATIONIQ_KEY, MAPBOX_TOKEN (optional fallback), OPENTRIPMAP_KEY
 */
const LUCENA = {
  minLat: 13.8800,
  maxLat: 13.9600,
  minLng: 121.5880,
  maxLng: 121.6430,
};
const TIMEOUT_MS = 2500;

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/**
 * ====== SMALL UTILS ======
 */
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function clampPoint(lat, lng) {
  return {
    lat: clamp(Number(lat), LUCENA.minLat, LUCENA.maxLat),
    lng: clamp(Number(lng), LUCENA.minLng, LUCENA.maxLng),
  };
}

function parseBboxParam(bboxStr) {
  if (!bboxStr || typeof bboxStr !== 'string') return null;
  const parts = bboxStr.split(',').map(s => parseFloat(s.trim()));
  if (parts.length !== 4 || parts.some(n => !Number.isFinite(n))) return null;
  let [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng > maxLng) [minLng, maxLng] = [maxLng, minLng];
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  return { minLng, minLat, maxLng, maxLat };
}

function intersectBbox(a, b) {
  const minLng = Math.max(a.minLng, b.minLng);
  const minLat = Math.max(a.minLat, b.minLat);
  const maxLng = Math.min(a.maxLng, b.maxLng);
  const maxLat = Math.min(a.maxLat, b.maxLat);
  if (minLng >= maxLng || minLat >= maxLat) return null; 
  return { minLng, minLat, maxLng, maxLat };
}

function clampOrIntersectBbox(bbox) {
  if (!bbox) return { ...LUCENA };
  const clamped = intersectBbox(bbox, LUCENA);
  return clamped || { ...LUCENA };
}

function withinLucena(lat, lng) {
  return (
    lat >= LUCENA.minLat && lat <= LUCENA.maxLat &&
    lng >= LUCENA.minLng && lng <= LUCENA.maxLng
  );
}

/**
 * ====== TINY IN-MEMORY CACHE ======
 */
const cache = new Map();
function setCache(key, data, ttlMs) {
  cache.set(key, { data, exp: Date.now() + ttlMs });
}

function getCache(key) {
  const v = cache.get(key);
  if (!v) return null;
  if (Date.now() > v.exp) { cache.delete(key); return null; }
  return v.data;
}

/**
 * ====== /api/places-search (LocationIQ primary, Mapbox fallback) ======
 * Query: q (>=3), lat, lng (optional, clamped to Lucena)
 * Returns: [{ label, lat, lng, type, source }]
 */
router.get('/api/places-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.status(400).json({ error: 'invalid_query' });

    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
    const focus = hasPoint ? clampPoint(lat, lng) : {
      lat: (LUCENA.minLat + LUCENA.maxLat) / 2,
      lng: (LUCENA.minLng + LUCENA.maxLng) / 2,
    };

    const cacheKey = `places:${q}:${focus.lat.toFixed(4)}:${focus.lng.toFixed(4)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const items = await searchPlaces(q, focus);
    // Final Lucena clamp safety
    const filtered = items.filter(it => withinLucena(it.lat, it.lng));

    // Cache 10 minutes
    setCache(cacheKey, filtered, 10 * 60 * 1000);
    res.json(filtered);
  } catch (e) {
    console.error('places-search error:', e.response?.data || e.message);
    res.json([]);
  }
});

async function searchPlaces(q, focus) {
  const out = [];

  // ===== LocationIQ primary =====
  const LIQ_KEY = process.env.LOCATIONIQ_KEY;
  if (LIQ_KEY) {
    try {
      const url = new URL('https://us1.locationiq.com/v1/autocomplete');
      url.searchParams.set('key', LIQ_KEY);
      url.searchParams.set('q', q);
      url.searchParams.set('limit', '10');
      // Bounded by Lucena viewbox
      url.searchParams.set('viewbox', [
        LUCENA.minLng, LUCENA.maxLat,
        LUCENA.maxLng, LUCENA.minLat 
      ].join(','));
      url.searchParams.set('bounded', '1'); 
      url.searchParams.set('accept-language', 'en');

      const r = await axios.get(url.toString(), { timeout: TIMEOUT_MS });
      const arr = Array.isArray(r.data) ? r.data : [];
      for (const it of arr) {
        const lat = Number(it.lat);
        const lng = Number(it.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        out.push({
          label: it.display_name || it.address?.name || it.name || it?.display_place || 'Place',
          lat, lng,
          type: it.type || 'place',
          source: 'locationiq',
        });
      }
      if (out.length >= 3) return out;
    } catch (e) {
    }
  }

  // ===== Mapbox fallback =====
  const MAPBOX = process.env.MAPBOX_TOKEN;
  if (MAPBOX) {
    try {
      const bbox = [LUCENA.minLng, LUCENA.minLat, LUCENA.maxLng, LUCENA.maxLat].join(',');
      const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`);
      url.searchParams.set('access_token', MAPBOX);
      url.searchParams.set('proximity', `${focus.lng},${focus.lat}`);
      url.searchParams.set('bbox', bbox);
      url.searchParams.set('limit', '10');
      url.searchParams.set('types', 'poi,address,place');

      const r = await axios.get(url.toString(), { timeout: TIMEOUT_MS });
      const feats = r.data?.features || [];
      for (const f of feats) {
        const [lng, lat] = f.center || [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        out.push({
          label: f.place_name || f.text || 'Place',
          lat, lng,
          type: (f.place_type && f.place_type[0]) || 'place',
          source: 'mapbox',
        });
      }
    } catch (e) {
      // console.warn('Mapbox fallback failed:', e.message);
    }
  }

  return out;
}

/**
 * ====== /api/pois (Overpass) ======
 * Query:
 *  - types: CSV from whitelist (e.g. cafe,convenience,pharmacy)
 *  - bbox: optional; format minLng,minLat,maxLng,maxLat (intersected with Lucena)
 * Returns: [{ id, name, lat, lng, category, source: 'overpass' }]
 */
const TYPE_TO_TAGS = {
  cafe: [{ k: 'amenity', v: 'cafe' }],
  convenience: [{ k: 'shop', v: 'convenience' }],
  pharmacy: [{ k: 'amenity', v: 'pharmacy' }],
  bank: [{ k: 'amenity', v: 'bank' }],
  atm: [{ k: 'amenity', v: 'atm' }],
  supermarket: [{ k: 'shop', v: 'supermarket' }],
  restaurant: [{ k: 'amenity', v: 'restaurant' }],
  fast_food: [{ k: 'amenity', v: 'fast_food' }],
  hospital: [{ k: 'amenity', v: 'hospital' }],
  school: [{ k: 'amenity', v: 'school' }],
  market: [{ k: 'amenity', v: 'marketplace' }],
  parking: [{ k: 'amenity', v: 'parking' }],
  taxi: [{ k: 'amenity', v: 'taxi' }],
  terminal: [
    { k: 'amenity', v: 'bus_station' },
    { k: 'public_transport', v: 'station' },
    { k: 'public_transport', v: 'stop_position' },
  ],
};

router.get('/api/pois', async (req, res) => {
  try {
    const csv = String(req.query.types || '').trim();
    const types = csv
      ? csv.split(',').map(s => s.trim()).filter(Boolean)
      : ['cafe', 'convenience', 'pharmacy'];

    // Build tag blocks
    const tagBlocks = [];
    for (const t of types) {
      const pairs = TYPE_TO_TAGS[t];
      if (!pairs) continue;
      for (const p of pairs) {
        tagBlocks.push(blockForTag(p.k, p.v));
      }
    }
    if (!tagBlocks.length) return res.json([]);

    const bboxStr = String(req.query.bbox || '');
    const reqBbox = parseBboxParam(bboxStr);
    const bbox = clampOrIntersectBbox(reqBbox || LUCENA);
    const { minLng, minLat, maxLng, maxLat } = bbox;

    const ql = wrapOverpassQuery(tagBlocks.join('\n'), { S: minLat, W: minLng, N: maxLat, E: maxLng });

    // Simple per-key rate limit via cache (3s)
    const cacheKey = `pois:${types.sort().join('|')}:${minLng.toFixed(3)},${minLat.toFixed(3)},${maxLng.toFixed(3)},${maxLat.toFixed(3)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const data = await callOverpass(ql);
    const elements = Array.isArray(data?.elements) ? data.elements : [];
    const out = elements.map(e => normalizeOverpassElement(e)).filter(Boolean);

    // 20 min cache
    setCache(cacheKey, out, 20 * 60 * 1000);
    res.json(out);
  } catch (e) {
    console.error('pois error:', e.response?.data || e.message);
    res.json([]); // safe empty
  }
});

function blockForTag(k, v) {
  // returns a union block (node/way/relation) for a single tag in a bbox placeholder
  return `
  node["${k}"="${v}"]({{S}},{{W}},{{N}},{{E}});
  way["${k}"="${v}"]({{S}},{{W}},{{N}},{{E}});
  relation["${k}"="${v}"]({{S}},{{W}},{{N}},{{E}});`;
}

function wrapOverpassQuery(body, bbox) {
  // bbox placeholders: {{S}} {{W}} {{N}} {{E}}
  const q = `
  [out:json][timeout:25];
  (
    ${body}
  );
  out center 200;
  `;
  return q
    .replaceAll('{{S}}', String(bbox.S))
    .replaceAll('{{W}}', String(bbox.W))
    .replaceAll('{{N}}', String(bbox.N))
    .replaceAll('{{E}}', String(bbox.E));
}

async function callOverpass(query) {
  // try primary, then fallback
  for (const base of OVERPASS_URLS) {
    try {
      const r = await axios.post(
        base,
        new URLSearchParams({ data: query }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 6000 }
      );
      return r.data;
    } catch (e) {
      // try next mirror
      // console.warn('Overpass failed on', base, e.message);
    }
  }
  throw new Error('All Overpass endpoints failed');
}

function normalizeOverpassElement(e) {
  // For nodes: lat/lon present. For ways/relations: center.lat/center.lon present (because of "out center").
  const lat = Number(e.lat ?? e.center?.lat);
  const lng = Number(e.lon ?? e.center?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (!withinLucena(lat, lng)) return null;

  const name = e.tags?.name || e.tags?.brand || e.tags?.operator || 'Unknown';
  // Try to guess category from tags minimalistically (optional)
  const category =
    e.tags?.amenity || e.tags?.shop || e.tags?.tourism || e.tags?.leisure || 'poi';

  return {
    id: `osm:${e.type}/${e.id}`,
    name,
    lat,
    lng,
    category,
    source: 'overpass',
  };
}

/**
 * ====== /api/landmarks (OpenTripMap) ======
 * Query:
 *  - bbox optional (same format), clamped to Lucena if provided
 *  - limit (default 50, max 100)
 * Returns: [{ id, name, lat, lng, kinds, source: 'opentripmap' }]
 */
router.get('/api/landmarks', async (req, res) => {
  try {
    const paramBbox = parseBboxParam(String(req.query.bbox || ''));
    const bbox = clampOrIntersectBbox(paramBbox || LUCENA);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 100);

    const cacheKey = `landmarks:${bbox.minLng.toFixed(3)},${bbox.minLat.toFixed(3)},${bbox.maxLng.toFixed(3)},${bbox.maxLat.toFixed(3)}:${limit}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const out = await fetchOpenTripMap(bbox, limit);
    setCache(cacheKey, out, 3 * 60 * 60 * 1000); // 3 hours
    res.json(out);
  } catch (e) {
    console.error('landmarks error:', e.response?.data || e.message);
    res.json([]); 
  }
});

async function fetchOpenTripMap(bbox, limit) {
  const KEY = process.env.OPENTRIPMAP_KEY;
  if (!KEY) return [];

  const url = new URL('https://api.opentripmap.com/0.1/en/places/bbox');
  url.searchParams.set('lon_min', String(bbox.minLng));
  url.searchParams.set('lat_min', String(bbox.minLat));
  url.searchParams.set('lon_max', String(bbox.maxLng));
  url.searchParams.set('lat_max', String(bbox.maxLat));
  url.searchParams.set('kinds', 'interesting_places');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('apikey', KEY);

  try {
    const r = await axios.get(url.toString(), { timeout: TIMEOUT_MS });
    const arr = Array.isArray(r.data?.features) ? r.data.features : [];
    const out = [];
    for (const f of arr) {
      const coords = f.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) continue;
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!withinLucena(lat, lng)) continue;

      out.push({
        id: f.id ? `otm:${f.id}` : 'otm:unknown',
        name: f.properties?.name || 'Landmark',
        lat,
        lng,
        kinds: (f.properties?.kinds || '').split(',').filter(Boolean),
        source: 'opentripmap',
      });
    }
    return out;
  } catch (e) {
    // console.warn('OpenTripMap failed:', e.message);
    return [];
  }
}

module.exports = router;
