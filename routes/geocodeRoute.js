const express = require('express');
const axios = require('axios');
const router = express.Router();

// GET /api/geocode?q=batangas city&lat=13.94&lon=121.62
router.get('/api/geocode', async (req, res) => {
  const { q, lat, lon } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing q' });

  const url = new URL('https://api.openrouteservice.org/geocode/autocomplete');
  url.searchParams.set('api_key', process.env.ORS_API_KEY);
  url.searchParams.set('text', q);
  url.searchParams.set('size', '5');
  if (lat && lon) {
    url.searchParams.set('focus.point.lat', lat);
    url.searchParams.set('focus.point.lon', lon);
  }

  try {
    const r = await axios.get(url.toString());
    const items = (r.data.features || []).map(f => ({
      label: f.properties?.label,
      lat: f.geometry?.coordinates?.[1],
      lon: f.geometry?.coordinates?.[0],
    }));
    res.json(items);
  } catch (e) {
    console.error('Geocode failed:', e.response?.data || e.message);
    res.status(500).json({ error: 'Geocode failed' });
  }
});

module.exports = router;
