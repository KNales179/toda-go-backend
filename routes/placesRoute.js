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


function metersToDegLat(m) { return m / 111_320; }
function metersToDegLng(m, lat) {
  const c = Math.cos((lat * Math.PI) / 180);
  return m / (111_320 * Math.max(c, 0.2));
}
function distM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function cellMetersForZoom(z) {
  if (z <= 12) return 500;
  if (z === 13) return 450;
  if (z === 14) return 400;
  if (z === 15) return 300;
  if (z === 16) return 200;
  if (z === 17) return 100;
  if (z === 18) return 50;
  return 28; // 19+
}
function perCellMaxForZoom(z) {
  if (z <= 14) return 1;
  if (z <= 16) return 2;
  return 3;
}
function jitter(it) {
  const m = 6 + Math.random() * 4; // 6-10m
  const ang = Math.random() * Math.PI * 2;
  const dLat = metersToDegLat(m * Math.sin(ang));
  const dLng = metersToDegLng(m * Math.cos(ang), it.lat);
  return { ...it, lat: it.lat + dLat, lng: it.lng + dLng };
}
function chooseInCell(items, center, keep) {
  const seenCat = new Set();
  const scored = items.map((it) => {
    const hasName = it.name && it.name !== 'Unnamed';
    const d = center ? distM(center, { lat: it.lat, lng: it.lng }) : 0;
    return { it, score: (hasName ? 2 : 0) - d / 1000 };
  });
  scored.sort((a, b) => b.score - a.score);

  const out = [];
  // first pass: promote category diversity
  for (const s of scored) {
    if (out.length >= keep) break;
    if (!seenCat.has(s.it.category)) {
      seenCat.add(s.it.category);
      out.push(jitter(s.it));
    }
  }
  // second: fill remaining slots by score
  if (out.length < keep) {
    for (const s of scored) {
      if (out.length >= keep) break;
      if (!out.find((x) => x.id === s.it.id)) out.push(jitter(s.it));
    }
  }
  return out;
}
function thinPoisAdaptive(pois, { zoom = 15, clat, clng, bbox }) {
  if (!pois?.length) return [];
  const cellM = cellMetersForZoom(zoom);
  const keepPerCell = perCellMaxForZoom(zoom);
  const center = (clat != null && clng != null) ? { lat: Number(clat), lng: Number(clng) } : null;

  const latRef = center?.lat ?? (bbox ? (bbox.minLat + bbox.maxLat) / 2 : 0);
  const degLat = metersToDegLat(cellM);
  const degLng = metersToDegLng(cellM, latRef);

  const grid = new Map();
  for (const p of pois) {
    const cx = Math.floor(p.lng / degLng);
    const cy = Math.floor(p.lat / degLat);
    const key = `${cx}:${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
  }

  const selected = [];
  for (const arr of grid.values()) {
    const chosen = chooseInCell(arr, center, keepPerCell);
    selected.push(...chosen);
  }
  return selected;
}
// ----------------------------------------------------------

function snapTo(v, step = 0.01) {
  return Math.round(v / step) * step;
}

function overscanBbox(b, factor = 0.15) {
  const { minLng, minLat, maxLng, maxLat } = b;
  const dLng = (maxLng - minLng) * factor;
  const dLat = (maxLat - minLat) * factor;
  return {
    minLng: minLng - dLng,
    minLat: minLat - dLat,
    maxLng: maxLng + dLng,
    maxLat: maxLat + dLat,
  };
}

/** Snap a bbox to a grid so nearby pans reuse cache */
function snapBbox(b, step = 0.01) {
  return {
    minLng: snapTo(b.minLng, step),
    minLat: snapTo(b.minLat, step),
    maxLng: snapTo(b.maxLng, step),
    maxLat: snapTo(b.maxLat, step),
  };
}

const pending = new Map(); 

async function getOrStart(cacheKey, starter) {
  if (pending.has(cacheKey)) return pending.get(cacheKey);
  const p = starter().finally(() => pending.delete(cacheKey));
  pending.set(cacheKey, p);
  return p;
}


router.get('/api/pois', async (req, res) => {
  try {
    // 1) Parse inputs
    const types = String(req.query.types || 'cafe,convenience,pharmacy')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const bbox = parseBbox(String(req.query.bbox || '')) || { ...LUCENA };
    const snapped = snapBbox(bbox, 0.01);         
    const expanded = overscanBbox(snapped, 0.20); 
    const { minLng, minLat, maxLng, maxLat } = bbox;
    

    const zoom = Number(req.query.zoom) || 15;
    const clat = req.query.clat != null ? Number(req.query.clat) : null;
    const clng = req.query.clng != null ? Number(req.query.clng) : null;
    const hasCenter = Number.isFinite(clat) && Number.isFinite(clng);

    // 2) Soft global caps (still applied after thinning)
    const zoomBucket = zoom <= 13 ? 13 : zoom >= 19 ? 19 : Math.round(zoom);
    const defaultTotalByZoom = ({ 13: 10, 14: 15, 15: 20, 16: 25, 17: 30 }[zoomBucket]) || 15;

    const totalLimit  = Math.min(Number(req.query.limit) || defaultTotalByZoom, 400);
    const perTypeHard = Math.min(
      Number(req.query.perTypeLimit) || Math.ceil((totalLimit || 1) / Math.max(types.length,1)),
      50
    );
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

    // 4) Cache raw Overpass results for this bbox+types
    const cacheKey = `poisRaw:${types.sort().join('|')}:${minLng.toFixed(2)},${minLat.toFixed(2)},${maxLng.toFixed(2)},${maxLat.toFixed(2)}`;
    let raw = getCache(cacheKey);
    if (!raw) {
      const data = await getOrStart(cacheKey, async () => {
        const d = await callOverpass(ql);
        return d;
      });
      raw = (data?.elements || []).map(e => {
        const lat = Number(e.lat ?? e.center?.lat);
        const lng = Number(e.lon ?? e.center?.lon);
        const tags = e.tags || {};
        return {
          id: `osm:${e.type}/${e.id}`,
          name: (tags.name || tags.brand || tags.operator || '').trim() || 'Unnamed',
          lat, lng,
          category: (tags.amenity || tags.shop || tags.tourism || 'poi').toLowerCase(),
          _tags: tags,
        };
      }).filter(it => Number.isFinite(it.lat) && Number.isFinite(it.lng) && withinLucena(it.lat, it.lng));
      const ttl = zoom < 15 ? 5 * 60 * 1000 : 2 * 60 * 1000;
      setCache(cacheKey, raw, ttl); 
    }

    // 5) center-first sorting + soft duplicate collapse
    const toRad = x => x * Math.PI / 180;
    const hav = (aLat, aLng, bLat, bLng) => {
      const R = 6371000;
      const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
      const s1 = Math.sin(dLat/2)**2 +
                 Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLng/2)**2;
      return 2*R*Math.asin(Math.sqrt(s1));
    };

    const byKey = new Map();
    for (const it of raw) {
      if (!types.includes(it.category)) continue; // defensive
      const nameKey = it.name.toLowerCase().replace(/\s+/g, ' ').trim();
      const k = `${nameKey}|${it.category}`;
      if (!byKey.has(k)) { byKey.set(k, it); continue; }
      const kept = byKey.get(k);
      const mutual = hav(kept.lat, kept.lng, it.lat, it.lng);
      if (mutual <= 25) {
        if (hasCenter) {
          const dKeep = hav(clat, clng, kept.lat, kept.lng);
          const dNew  = hav(clat, clng, it.lat,  it.lng);
          if (dNew < dKeep) byKey.set(k, it);
        }
      } else {
        // different place, keep both
        byKey.set(`${k}|${it.id}`, it);
      }
    }
    let items = Array.from(byKey.values());

    if (hasCenter) {
      for (const it of items) it._dist = hav(clat, clng, it.lat, it.lng);
      items.sort((a, b) => a._dist - b._dist);
    }

    // 6) per-type hard cap (nearest first)
    const buckets = new Map();
    for (const it of items) {
      if (!buckets.has(it.category)) buckets.set(it.category, []);
      const arr = buckets.get(it.category);
      if (arr.length < perTypeHard) arr.push(it);
    }
    let merged = Array.from(buckets.values()).flat();

    // 7) **adaptive thinning**: one-per-cell (zoom-aware) with slight jitter
    merged = thinPoisAdaptive(merged, { zoom, clat, clng, bbox });

    // 8) final global cap (closest first if center provided)
    if (merged.length > totalLimit) {
      if (hasCenter) merged.sort((a, b) => a._dist - b._dist);
      merged = merged.slice(0, totalLimit);
    }

    const out = merged.map(({ id, name, lat, lng, category }) => ({
      id, name, lat, lng, category, source: 'overpass'
    }));

    res.set('X-POI-Count', String(out.length));
    return res.json(out);
  } catch (e) {
    console.error('pois:', e.response?.data || e.message);
    return res.json([]);
  }
});

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

    const ql = `[out:json][timeout:25]; (${body}); out center 200;`;

    if (req.query.debug === '1') {
      return res.json({ bbox, queryBuilt: ql });
    }

    const cacheKey = `landmarks:${minLng.toFixed(3)},${minLat.toFixed(3)},${maxLng.toFixed(3)},${maxLat.toFixed(3)}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    const data = await callOverpass(ql);
    let items = (data?.elements || [])
      .map(e => {
        const lat = Number(e.lat ?? e.center?.lat);
        const lng = Number(e.lon ?? e.center?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !withinLucena(lat, lng)) return null;
        const tags = e.tags || {};
        const category =
          tags.tourism || tags.amenity || tags.historic || tags.leisure || tags.natural || 'landmark';
        return {
          id: `osm:${e.type}/${e.id}`,
          name: tags.name || tags.brand || tags.operator || 'Landmark',
          lat,
          lng,
          category,
          source: 'overpass',
        };
      })
      .filter(Boolean);

    // -----------------------------
    // 🔍 Filtering logic starts here
    // -----------------------------
    const DROP_CATEGORIES = new Set([
      'parking', 'townhall', 'sports_centre', 'playground',
      'library', 'information', 'wood'
    ]);
    const WORSHIP_KEEP = /(Cathedral|Parish|Basilica|Shrine|Mosque|Iglesia\s*ni\s*Cristo)/i;
    const MONUMENT_KEEP = /(Quezon|Bonifacio|Mabini|Luna|Del\s*Pilar|Fausta|Gomburza)/i;

    const isPlaceholder = (name) => !name || !name.trim() || /^landmark$/i.test(name.trim());
    const toRad = (d) => d * Math.PI / 180;
    const haversine = (a, b) => {
      const R = 6371000;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const s1 = Math.sin(dLat/2), s2 = Math.sin(dLng/2);
      return 2 * R * Math.asin(Math.sqrt(s1*s1 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*s2*s2));
    };
    const NAME_BLACKLIST = [
      /eco\s*park/i,
      /botanical\s*garden/i,
      /camp\s*baculi/i,
      /carabao\s*fountain/i
    ];

    const keep = (it) => {
      const { name, category } = it;
      if (isPlaceholder(name)) return false;
      if (DROP_CATEGORIES.has(category)) return false;
      if (NAME_BLACKLIST.some(r => r.test(name))) return false;
      if (category === 'place_of_worship' && !WORSHIP_KEEP.test(name)) return false;
      if ((category === 'artwork' || category === 'fountain') && name.length < 3) return false;
      if ((category === 'memorial' || category === 'monument') && !MONUMENT_KEEP.test(name)) return false;
      return true;
    };

    // ✅ Apply filtering
    items = items.filter(keep);

    // ✅ De-duplicate by name & proximity (~80m)
    const deduped = [];
    for (const it of items) {
      const dup = deduped.find(o =>
        o.name.toLowerCase() === it.name.toLowerCase() &&
        haversine(o, it) < 80
      );
      if (!dup) deduped.push(it);
    }

    // ✅ Sort by category weight
    const weight = {
      park: 1, garden: 1, botanical_garden: 1, beach: 1, museum: 1, attraction: 1,
      memorial: 2, monument: 2, place_of_worship: 2, artwork: 3, fountain: 3
    };
    deduped.sort((a, b) => (weight[a.category] ?? 9) - (weight[b.category] ?? 9));

    // ✅ Cap total count
    const MAX = 150;
    const finalOut = deduped.slice(0, MAX);

    setCache(cacheKey, finalOut, 3 * 60 * 60 * 1000);
    res.json(finalOut);
  } catch (e) {
    console.error('landmarks:', e.response?.data || e.message);
    res.json([]);
  }
});


module.exports = router;
