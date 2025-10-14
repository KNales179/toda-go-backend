// routes/placesRoute.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

/* =========================
   Lucena hard bounds (use everywhere)
   ========================= */
const LUCENA = {
  minLat: 13.8800,
  maxLat: 13.9600,
  minLng: 121.5900,
  maxLng: 121.6430,
};

const TIMEOUT_MS = 3000;

/* =========================
   Tiny in-memory cache
   ========================= */
const cache = new Map();
function setCache(key, data, ttlMs) {
  cache.set(key, { data, exp: Date.now() + ttlMs });
}
function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

/* =========================
   Helpers
   ========================= */
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v)));

function withinLucena(lat, lng) {
  return (
    lat >= LUCENA.minLat && lat <= LUCENA.maxLat &&
    lng >= LUCENA.minLng && lng <= LUCENA.maxLng
  );
}

function parseBbox(str) {
  // Format: minLng,minLat,maxLng,maxLat
  if (!str || typeof str !== 'string') return null;
  const p = str.split(',').map(s => parseFloat(s.trim()));
  if (p.length !== 4 || p.some(n => !Number.isFinite(n))) return null;
  let [minLng, minLat, maxLng, maxLat] = p;
  if (minLng > maxLng) [minLng, maxLng] = [maxLng, minLng];
  if (minLat > maxLat) [minLat, maxLat] = [maxLat, minLat];
  // Intersect with Lucena bounds
  minLng = Math.max(minLng, LUCENA.minLng);
  minLat = Math.max(minLat, LUCENA.minLat);
  maxLng = Math.min(maxLng, LUCENA.maxLng);
  maxLat = Math.min(maxLat, LUCENA.maxLat);
  if (minLng >= maxLng || minLat >= maxLat) return { ...LUCENA };
  return { minLng, minLat, maxLng, maxLat };
}

function centerOf(b) {
  return {
    lat: (b.minLat + b.maxLat) / 2,
    lng: (b.minLng + b.maxLng) / 2,
  };
}

/* =========================
   Overpass (no key) with mirrors
   ========================= */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

async function callOverpass(query) {
  const body = new URLSearchParams({ data: query }).toString();
  for (const base of OVERPASS_MIRRORS) {
    try {
      const r = await axios.post(base, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      });
      return r.data;
    } catch (_) {
      // try next mirror
    }
  }
  throw new Error('All Overpass mirrors failed');
}

/* =========================
   1) /api/places-search  (LocationIQ)
   =========================
   Query: q (>=3), lat, lng (optional; clamped)
   Returns: [{ label, lat, lng, type, source: 'locationiq' }]
*/
router.get('/api/places-search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) return res.status(400).json({ error: 'invalid_query' });

    const base = { ...LUCENA };
    const focus = {
      lat: clamp(req.query.lat ?? centerOf(base).lat, base.minLat, base.maxLat),
      lng: clamp(req.query.lng ?? centerOf(base).lng, base.minLng, base.maxLng),
    };

    const cacheKey = `liq:${q}:${focus.lat.toFixed(4)}:${focus.lng.toFixed(4)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const key = process.env.LOCATIONIQ_KEY;
    if (!key) return res.status(500).json({ error: 'Server misconfig: LOCATIONIQ_KEY missing' });

    const url = new URL('https://us1.locationiq.com/v1/autocomplete');
    url.searchParams.set('key', key);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '10');
    // LocationIQ viewbox = west,north,east,south
    url.searchParams.set('viewbox', [
      LUCENA.minLng, LUCENA.maxLat, LUCENA.maxLng, LUCENA.minLat,
    ].join(','));
    url.searchParams.set('bounded', '1');
    url.searchParams.set('accept-language', 'en');

    const r = await axios.get(url.toString(), { timeout: TIMEOUT_MS });
    const arr = Array.isArray(r.data) ? r.data : [];

    const items = arr
      .map(it => ({
        label: it.display_name || it.display_place || it.name || 'Place',
        lat: Number(it.lat),
        lng: Number(it.lon),
        type: it.type || 'place',
        source: 'locationiq',
      }))
      .filter(it => Number.isFinite(it.lat) && Number.isFinite(it.lng) && withinLucena(it.lat, it.lng));

    setCache(cacheKey, items, 10 * 60 * 1000);
    res.json(items);
  } catch (e) {
    console.error('places-search:', e.response?.data || e.message);
    res.json([]); // safe empty
  }
});

/* =========================
   2) /api/pois  (Overpass)
   =========================
   Query:
     - types CSV (default: cafe,convenience,pharmacy)
     - bbox (optional) minLng,minLat,maxLng,maxLat (intersected with Lucena)
   Returns: [{ id, name, lat, lng, category, source: 'overpass' }]
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
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

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

    const ql = `
      [out:json][timeout:25];
      (
        ${blocks.join('\n')}
      );
      out center 200;
    `;

    if (req.query.debug === '1') {
      return res.json({ bbox, queryBuilt: ql });
    }

    const cacheKey = `pois:${types.sort().join('|')}:${minLng.toFixed(3)},${minLat.toFixed(3)},${maxLng.toFixed(3)},${maxLat.toFixed(3)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const data = await callOverpass(ql);
    const out = (data?.elements || [])
      .map(e => {
        const lat = Number(e.lat ?? e.center?.lat);
        const lng = Number(e.lon ?? e.center?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !withinLucena(lat, lng)) return null;
        const tags = e.tags || {};
        return {
          id: `osm:${e.type}/${e.id}`,
          name: tags.name || tags.brand || tags.operator || 'Unnamed',
          lat, lng,
          category: tags.amenity || tags.shop || tags.tourism || 'poi',
          source: 'overpass',
        };
      })
      .filter(Boolean);

    setCache(cacheKey, out, 20 * 60 * 1000);
    res.json(out);
  } catch (e) {
    console.error('pois:', e.response?.data || e.message);
    res.json([]); // safe empty
  }
});

/* =========================
   3) /api/landmarks  (Overpass)
   =========================
   Rich “Explore” layer: parks, places of worship, attractions, monuments, beaches, etc.
   Query: optional bbox (minLng,minLat,maxLng,maxLat)
   Returns: [{ id, name, lat, lng, category, source: 'overpass' }]
*/
router.get('/api/landmarks', async (req, res) => {
  try {
    const bbox = parseBbox(String(req.query.bbox || '')) || { ...LUCENA };
    const { minLng, minLat, maxLng, maxLat } = bbox;

    const body = `
      // tourism
      node["tourism"~"attraction|museum|artwork|viewpoint|information|theme_park|zoo|aquarium"](${minLat},${minLng},${maxLat},${maxLng});
      way ["tourism"~"attraction|museum|artwork|viewpoint|information|theme_park|zoo|aquarium"](${minLat},${minLng},${maxLat},${maxLng});
      relation["tourism"~"attraction|museum|artwork|viewpoint|information|theme_park|zoo|aquarium"](${minLat},${minLng},${maxLat},${maxLng});

      // amenity / leisure
      node["amenity"~"park|place_of_worship|theatre|arts_centre|fountain|library|townhall"](${minLat},${minLng},${maxLat},${maxLng});
      way ["amenity"~"park|place_of_worship|theatre|arts_centre|fountain|library|townhall"](${minLat},${minLng},${maxLat},${maxLng});
      relation["amenity"~"park|place_of_worship|theatre|arts_centre|fountain|library|townhall"](${minLat},${minLng},${maxLat},${maxLng});

      node["leisure"~"park|playground|garden|sports_centre|stadium"](${minLat},${minLng},${maxLat},${maxLng});
      way ["leisure"~"park|playground|garden|sports_centre|stadium"](${minLat},${minLng},${maxLat},${maxLng});
      relation["leisure"~"park|playground|garden|sports_centre|stadium"](${minLat},${minLng},${maxLat},${maxLng});

      // natural / historic
      node["natural"~"beach|wood|spring"](${minLat},${minLng},${maxLat},${maxLng});
      way ["natural"~"beach|wood|spring"](${minLat},${minLng},${maxLat},${maxLng});
      relation["natural"~"beach|wood|spring"](${minLat},${minLng},${maxLat},${maxLng});

      node["historic"~"monument|memorial|ruins"](${minLat},${minLng},${maxLat},${maxLng});
      way ["historic"~"monument|memorial|ruins"](${minLat},${minLng},${maxLat},${maxLng});
      relation["historic"~"monument|memorial|ruins"](${minLat},${minLng},${maxLat},${maxLng});
    `;

    const ql = `
      [out:json][timeout:25];
      (
        ${body}
      );
      out center 200;
    `;

    if (req.query.debug === '1') {
      return res.json({ bbox, queryBuilt: ql });
    }

    const cacheKey = `landmarks:${minLng.toFixed(3)},${minLat.toFixed(3)},${maxLng.toFixed(3)},${maxLat.toFixed(3)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const data = await callOverpass(ql);
    const out = (data?.elements || [])
      .map(e => {
        const lat = Number(e.lat ?? e.center?.lat);
        const lng = Number(e.lon ?? e.center?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !withinLucena(lat, lng)) return null;

        const tags = e.tags || {};
        const category = tags.tourism || tags.amenity || tags.historic || tags.leisure || tags.natural || 'landmark';

        return {
          id: `osm:${e.type}/${e.id}`,
          name: tags.name || tags.brand || tags.operator || 'Landmark',
          lat, lng,
          category,
          source: 'overpass',
        };
      })
      .filter(Boolean);

    setCache(cacheKey, out, 3 * 60 * 60 * 1000);
    res.json(out);
  } catch (e) {
    console.error('landmarks:', e.response?.data || e.message);
    res.json([]); // safe empty
  }
});

module.exports = router;
