// routes/placesRoute.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

/** ===== Lucena hard bounds (apply everywhere) ===== */
const LUCENA = { minLat: 13.8800, maxLat: 13.9600, minLng: 121.5900, maxLng: 121.6430 };
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const TIMEOUT = 3000;

/** ===== tiny in-memory cache ===== */
const cache = new Map();
const setCache = (k, v, ttlMs) => cache.set(k, { v, exp: Date.now() + ttlMs });
const getCache = (k) => {
  const hit = cache.get(k);
  if (!hit || Date.now() > hit.exp) return null;
  return hit.v;
};

const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n)));
const centerOf = (b) => ({ lat: (b.minLat + b.maxLat) / 2, lng: (b.minLng + b.maxLng) / 2 });
const within = (lat, lng) =>
  lat >= LUCENA.minLat && lat <= LUCENA.maxLat && lng >= LUCENA.minLng && lng <= LUCENA.maxLng;

function parseBbox(str) {
  // minLng,minLat,maxLng,maxLat
  if (!str) return null;
  const p = str.split(',').map(s => parseFloat(s.trim()));
  if (p.length !== 4 || p.some(x => !Number.isFinite(x))) return null;
  let [minLng, minLat, maxLng, maxLat] = p;
  if (minLng > maxLng) [minLng, maxLng] = [maxLng, minLng];
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  // intersect with LUCENA
  minLng = Math.max(minLng, LUCENA.minLng);
  minLat = Math.max(minLat, LUCENA.minLat);
  maxLng = Math.min(maxLng, LUCENA.maxLng);
  maxLat = Math.min(maxLat, LUCENA.maxLat);
  if (minLng >= maxLng || minLat >= maxLat) return { ...LUCENA };
  return { minLng, minLat, maxLng, maxLat };
}

/* -------------------------------------------------------------------------- */
/* 1) /api/places-search  (LocationIQ; Lucena-bounded)                         */
/* -------------------------------------------------------------------------- */
/**
 * Query: q (>=3), lat, lng (optional; clamped to Lucena)
 * Returns: [{ label, lat, lng, type:'poi|address|place', source:'locationiq' }]
 */
router.get('/api/places-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.status(400).json({ error: 'invalid_query' });

    const lat = clamp(req.query.lat ?? centerOf(LUCENA).lat, LUCENA.minLat, LUCENA.maxLat);
    const lng = clamp(req.query.lng ?? centerOf(LUCENA).lng, LUCENA.minLng, LUCENA.maxLng);

    const cacheKey = `liq:${q}:${lat.toFixed(4)}:${lng.toFixed(4)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const key = process.env.LOCATIONIQ_KEY;
    if (!key) return res.status(500).json({ error: 'Server misconfig: LOCATIONIQ_KEY missing' });

    // LocationIQ autocomplete with viewbox clamp
    const url = new URL('https://us1.locationiq.com/v1/autocomplete');
    url.searchParams.set('key', key);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '10');
    // viewbox = west,north,east,south
    url.searchParams.set('viewbox', [
      LUCENA.minLng, LUCENA.maxLat, LUCENA.maxLng, LUCENA.minLat,
    ].join(','));
    url.searchParams.set('bounded', '1');
    url.searchParams.set('accept-language', 'en');

    const r = await axios.get(url.toString(), { timeout: TIMEOUT });
    const raw = Array.isArray(r.data) ? r.data : [];

    const items = raw.map(it => {
      const item = {
        label: it.display_name || it.name || it.display_place || 'Place',
        lat: Number(it.lat),
        lng: Number(it.lon),
        type: it.type || 'place',
        source: 'locationiq',
      };
      return item;
    }).filter(it => Number.isFinite(it.lat) && Number.isFinite(it.lng) && within(it.lat, it.lng));

    setCache(cacheKey, items, 10 * 60 * 1000); // 10 min
    res.json(items);
  } catch (e) {
    console.error('places-search:', e.response?.data || e.message);
    res.json([]); // safe empty
  }
});

/* -------------------------------------------------------------------------- */
/* 2) /api/pois  (Overpass; no key)                                            */
/* -------------------------------------------------------------------------- */
/**
 * Query:
 *  - types CSV from whitelist (default: cafe,convenience,pharmacy)
 *  - bbox optional (minLng,minLat,maxLng,maxLat); intersected with Lucena
 * Returns: [{ id, name, lat, lng, category, source:'overpass' }]
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
    const types = String(req.query.types || 'cafe,convenience,pharmacy')
      .split(',').map(s => s.trim()).filter(Boolean);

    const bbox = parseBbox(String(req.query.bbox || '')) || { ...LUCENA };
    const { minLng, minLat, maxLng, maxLat } = bbox;

    const blocks = [];
    for (const t of types) {
      const pairs = TYPE_TO_TAGS[t];
      if (!pairs) continue;
      for (const p of pairs) {
        blocks.push(`
          node["${p.k}"="${p.v}"](${minLat},${minLng},${maxLat},${maxLng});
          way["${p.k}"="${p.v}"](${minLat},${minLng},${maxLat},${maxLng});
          relation["${p.k}"="${p.v}"](${minLat},${minLng},${maxLat},${maxLng});
        `);
      }
    }
    if (!blocks.length) return res.json([]);

    const query = `
      [out:json][timeout:25];
      (
        ${blocks.join('\n')}
      );
      out center 200;
    `;

    const cacheKey = `pois:${types.sort().join('|')}:${minLng.toFixed(3)},${minLat.toFixed(3)},${maxLng.toFixed(3)},${maxLat.toFixed(3)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const resp = await axios.post(OVERPASS, query, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 6000,
    });

    const out = (resp.data?.elements || [])
      .map(e => {
        const lat = Number(e.lat ?? e.center?.lat);
        const lng = Number(e.lon ?? e.center?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !within(lat, lng)) return null;
        return {
          id: `osm:${e.type}/${e.id}`,
          name: e.tags?.name || e.tags?.brand || e.tags?.operator || 'Unnamed',
          lat, lng,
          category: e.tags?.amenity || e.tags?.shop || e.tags?.tourism || 'poi',
          source: 'overpass',
        };
      })
      .filter(Boolean);

    setCache(cacheKey, out, 20 * 60 * 1000); // 20 min
    res.json(out);
  } catch (e) {
    console.error('pois:', e.response?.data || e.message);
    res.json([]); // safe empty
  }
});

/* -------------------------------------------------------------------------- */
/* 3) /api/landmarks  (Overpass; no key)                                       */
/* -------------------------------------------------------------------------- */
/**
 * Landmarks/Explore using OSM tags (parks, attractions, monuments, churches, etc.)
 * Query: optional bbox (minLng,minLat,maxLng,maxLat)
 * Returns: [{ id, name, lat, lng, category, source:'overpass' }]
 */
router.get('/api/landmarks', async (req, res) => {
  try {
    const bbox = parseBbox(String(req.query.bbox || '')) || { ...LUCENA };
    const { minLng, minLat, maxLng, maxLat } = bbox;

    // Tourism/amenity tags that behave like “landmarks”
    const body = `
      node["tourism"~"attraction|museum|artwork|viewpoint|information"](${minLat},${minLng},${maxLat},${maxLng});
      way["tourism"~"attraction|museum|artwork|viewpoint|information"](${minLat},${minLng},${maxLat},${maxLng});
      relation["tourism"~"attraction|museum|artwork|viewpoint|information"](${minLat},${minLng},${maxLat},${maxLng});

      node["amenity"~"park|place_of_worship|theatre|arts_centre|fountain"](${minLat},${minLng},${maxLat},${maxLng});
      way["amenity"~"park|place_of_worship|theatre|arts_centre|fountain"](${minLat},${minLng},${maxLat},${maxLng});
      relation["amenity"~"park|place_of_worship|theatre|arts_centre|fountain"](${minLat},${minLng},${maxLat},${maxLng});

      node["historic"~"monument|memorial|ruins"](${minLat},${minLng},${maxLat},${maxLng});
      way["historic"~"monument|memorial|ruins"](${minLat},${minLng},${maxLat},${maxLng});
      relation["historic"~"monument|memorial|ruins"](${minLat},${minLng},${maxLat},${maxLng});
    `;

    const query = `
      [out:json][timeout:25];
      (
        ${body}
      );
      out center 200;
    `;

    const cacheKey = `landmarks:${minLng.toFixed(3)},${minLat.toFixed(3)},${maxLng.toFixed(3)},${maxLat.toFixed(3)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const resp = await axios.post(OVERPASS, query, {
      headers: { 'Content-Type': 'text/plain' },
      timeout: 6000,
    });

    const out = (resp.data?.elements || [])
      .map(e => {
        const lat = Number(e.lat ?? e.center?.lat);
        const lng = Number(e.lon ?? e.center?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !within(lat, lng)) return null;

        const tags = e.tags || {};
        const category =
          tags.tourism || tags.amenity || tags.historic || tags.leisure || 'landmark';

        return {
          id: `osm:${e.type}/${e.id}`,
          name: tags.name || tags.brand || tags.operator || 'Landmark',
          lat, lng,
          category,
          source: 'overpass',
        };
      })
      .filter(Boolean);

    setCache(cacheKey, out, 3 * 60 * 60 * 1000); // 3 hours
    res.json(out);
  } catch (e) {
    console.error('landmarks:', e.response?.data || e.message);
    res.json([]); // safe empty
  }
});

module.exports = router;
