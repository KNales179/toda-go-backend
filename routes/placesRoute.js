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
  terminal: [
    { k: 'amenity', v: 'bus_station' },
    { k: 'public_transport', v: 'station' },
    { k: 'public_transport', v: 'stop_position' },
  ],
};

router.get('/api/pois', async (req, res) => {
  try {
    // 1) Parse inputs
    const types = String(req.query.types || 'cafe,convenience,pharmacy')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const bbox = parseBbox(String(req.query.bbox || '')) || { ...LUCENA };
    const { minLng, minLat, maxLng, maxLat } = bbox;

    const zoom = Number(req.query.zoom) || 15;
    const clat = req.query.clat != null ? Number(req.query.clat) : null;
    const clng = req.query.clng != null ? Number(req.query.clng) : null;
    const hasCenter = Number.isFinite(clat) && Number.isFinite(clng);

    // 2) Dynamic caps (feel free to tune)
    const zoomBucket = zoom <= 13 ? 13 : zoom >= 17 ? 17 : Math.round(zoom);
    const defaultTotalByZoom = ({13: 60, 14: 120, 15: 180, 16: 240, 17: 300}[zoomBucket]) || 180;

    const totalLimit  = Math.max(10, Math.min( Number(req.query.limit)  || defaultTotalByZoom,  400 ));
    const perTypeHard = Math.max(8,  Math.min( Number(req.query.perTypeLimit) || Math.ceil(totalLimit / Math.max(types.length,1)), 120 ));

    // 3) Build Overpass QL blocks per requested type
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
      return res.json({
        bbox, zoom, center: hasCenter ? { clat, clng } : null,
        totalLimit, perTypeHard, queryBuilt: ql
      });
    }

    // 4) Cache (cache raw results for bbox+types; sort/limit per-request)
    const cacheKey = `poisRaw:${types.sort().join('|')}:${minLng.toFixed(3)},${minLat.toFixed(3)},${maxLng.toFixed(3)},${maxLat.toFixed(3)}`;
    let raw = getCache(cacheKey);
    if (!raw) {
      const data = await callOverpass(ql);
      raw = (data?.elements || []).map(e => {
        const lat = Number(e.lat ?? e.center?.lat);
        const lng = Number(e.lon ?? e.center?.lon);
        const tags = e.tags || {};
        return {
          id: `osm:${e.type}/${e.id}`,
          name: (tags.name || tags.brand || tags.operator || '').trim() || 'Unnamed',
          lat, lng,
          category: (tags.amenity || tags.shop || tags.tourism || 'poi').toLowerCase(),
          _tags: tags, // keep for light post-filter if needed
        };
      }).filter(it => Number.isFinite(it.lat) && Number.isFinite(it.lng) && withinLucena(it.lat, it.lng));
      // 2 minutes cache: fast pan ≙ reuse
      setCache(cacheKey, raw, 2 * 60 * 1000);
    }

    // 5) Center-aware distance + de-dup
    const toRad = x => x * Math.PI / 180;
    const hav = (aLat, aLng, bLat, bLng) => {
      const R = 6371000;
      const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
      const s1 = Math.sin(dLat/2)**2 +
                 Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
      return 2*R*Math.asin(Math.sqrt(s1)); // meters
    };

    // Soft de-dup: same rounded name within 25m → keep closest
    const byKey = new Map();
    for (const it of raw) {
      const nameKey = it.name.toLowerCase().replace(/\s+/g, ' ').trim();
      const k = `${nameKey}|${it.category}`;
      if (!byKey.has(k)) { byKey.set(k, it); continue; }
      const kept = byKey.get(k);
      const dKeep = hasCenter ? hav(clat, clng, kept.lat, kept.lng) : 0;
      const dNew  = hasCenter ? hav(clat, clng, it.lat,  it.lng)  : Infinity; // prefer nearer when centered
      // Also consider true proximity between kept/new to collapse exact duplicates
      const mutual = hav(kept.lat, kept.lng, it.lat, it.lng);
      if (mutual <= 25 && dNew < dKeep) byKey.set(k, it);
    }
    let items = Array.from(byKey.values());

    // 6) Sort (center first) and light zoom-based prioritization
    if (hasCenter) {
      for (const it of items) it._dist = hav(clat, clng, it.lat, it.lng);
      items.sort((a, b) => a._dist - b._dist);
    }

    // 7) Per-type cap then global cap
    const buckets = new Map(); // cat -> array
    for (const it of items) {
      // Only keep requested types (defensive; Overpass query should already filter)
      if (!types.includes(it.category)) continue;
      if (!buckets.has(it.category)) buckets.set(it.category, []);
      const arr = buckets.get(it.category);
      if (arr.length < perTypeHard) arr.push(it);
    }

    let merged = Array.from(buckets.values()).flat();
    if (merged.length > totalLimit) {
      // keep the closest totalLimit overall (distance already computed if center provided)
      if (hasCenter) merged.sort((a, b) => a._dist - b._dist);
      merged = merged.slice(0, totalLimit);
    }

    // 8) Clean output
    const out = merged.map(({ id, name, lat, lng, category }) => ({
      id, name, lat, lng, category, source: 'overpass'
    }));

    return res.json(out);
  } catch (e) {
    console.error('pois:', e.response?.data || e.message);
    // No hard fail for the app—just return empty array
    return res.json([]);
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
