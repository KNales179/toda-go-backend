// routes/orsRoute.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

const ORS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';

function isNum(n) { return typeof n === 'number' && Number.isFinite(n); }
function okLat(x) { return isNum(x) && x >= -90 && x <= 90; }
function okLng(x) { return isNum(x) && x >= -180 && x <= 180; }
function validPair(p) { return Array.isArray(p) && p.length === 2 && okLng(p[0]) && okLat(p[1]); }

function parseQueryPair(s) {
  if (!s || typeof s !== 'string') return null;
  const [lngStr, latStr] = s.split(',').map(t => t.trim());
  const lng = parseFloat(lngStr), lat = parseFloat(latStr);
  return [lng, lat];
}

async function callORS(coords, ORS_KEY, extraBody = {}) {
  // coords must be [[lng,lat],[lng,lat]]
  return axios.post(
    ORS_URL,
    { coordinates: coords, ...extraBody },
    {
      headers: {
        Authorization: ORS_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
}

// POST /api/route  (accepts {coordinates} OR {start,end})
router.post('/api/route', async (req, res) => {
  const ORS_KEY = process.env.ORS_API_KEY;
  if (!ORS_KEY) return res.status(500).json({ error: "Server misconfig: ORS_API_KEY missing" });

  try {
    let coords = null;

    // A) Preferred: { coordinates: [[lng,lat],[lng,lat]] }
    if (Array.isArray(req.body?.coordinates) && req.body.coordinates.length >= 2) {
      coords = [req.body.coordinates[0], req.body.coordinates[1]];
    }

    // B) Fallback: { start:[lng,lat], end:[lng,lat] }
    if (!coords && req.body?.start && req.body?.end) {
      coords = [req.body.start, req.body.end];
    }

    if (!coords || !validPair(coords[0]) || !validPair(coords[1])) {
      return res.status(400).json({ error: "INVALID_INPUT", details: "Provide valid coordinates or start/end" });
    }

    const r = await callORS(coords, ORS_KEY);
    if (!r.data?.features?.length) {
      console.error('[ROUTE] ORS_NO_FEATURES', r.data);
      return res.status(502).json({ error: "ORS_NO_FEATURES", details: r.data });
    }
    res.json(r.data);
  } catch (e) {
    console.error('ORS failed:', e.response?.data || e.message);
    res.status(e.response?.status || 500).json({ error: 'ORS routing failed', details: e.response?.data || e.message });
  }
});

// GET /api/route?start=lng,lat&end=lng,lat  (also supported)
router.get('/api/route', async (req, res) => {
  const ORS_KEY = process.env.ORS_API_KEY;
  if (!ORS_KEY) return res.status(500).json({ error: "Server misconfig: ORS_API_KEY missing" });

  try {
    const start = parseQueryPair(req.query.start);
    const end   = parseQueryPair(req.query.end);
    if (!validPair(start) || !validPair(end)) {
      return res.status(400).json({ error: "INVALID_QUERY", details: "Use ?start=lng,lat&end=lng,lat" });
    }

    const coords = [start, end];
    const r = await callORS(coords, ORS_KEY);
    if (!r.data?.features?.length) {
      console.error('[ROUTE] ORS_NO_FEATURES', r.data);
      return res.status(502).json({ error: "ORS_NO_FEATURES", details: r.data });
    }
    res.json(r.data);
  } catch (e) {
    console.error('ORS failed:', e.response?.data || e.message);
    res.status(e.response?.status || 500).json({ error: 'ORS routing failed', details: e.response?.data || e.message });
  }
});

/**
 * 🔹 NEW: POST /api/route/variants
 * Body: { start: [lng,lat], end: [lng,lat] }
 * Returns: [{ id, preference, summary, coords:[ [lat,lng], ... ] }, ...]
 */
router.post('/api/route/variants', async (req, res) => {
  const ORS_KEY = process.env.ORS_API_KEY;
  if (!ORS_KEY) return res.status(500).json({ error: "Server misconfig: ORS_API_KEY missing" });

  try {
    const { start, end } = req.body || {};
    if (!validPair(start) || !validPair(end)) {
      return res.status(400).json({
        error: "INVALID_INPUT",
        details: "Provide { start:[lng,lat], end:[lng,lat] }",
      });
    }

    const coords = [start, end];

    // Try a few preferences to approximate “different main routes”
    const prefs = ["fastest"];
    const results = [];

    for (const pref of prefs) {
      try {
        const r = await callORS(coords, ORS_KEY, { preference: pref });
        const feat = r.data?.features?.[0];
        if (!feat?.geometry?.coordinates?.length) continue;

        const latLng = feat.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const summary = feat.properties?.summary || {};

        results.push({
          id: pref,
          preference: pref,
          coords: latLng,
          summary: {
            distance: summary.distance,
            duration: summary.duration,
          },
        });
      } catch (e) {
        console.error(`[ROUTE] variant ${pref} failed:`, e.response?.data || e.message);
      }
    }

    if (!results.length) {
      return res.status(502).json({ error: "ORS_NO_VARIANTS" });
    }

    res.json(results);
  } catch (e) {
    console.error('ORS variants failed:', e.response?.data || e.message);
    res.status(e.response?.status || 500).json({ error: 'ORS variants failed', details: e.response?.data || e.message });
  }
});

module.exports = router;
