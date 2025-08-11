const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/api/route', async (req, res) => {
  const { start, end } = req.body;
  const ORS_KEY = process.env.ORS_API_KEY;
  if (!start || !end) return res.status(400).json({ error: "Missing start or end" });
  if (!ORS_KEY)   return res.status(500).json({ error: "Server misconfig: ORS_API_KEY missing" });

  try {
    const url = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson'; // <-- GeoJSON!
    const r = await axios.post(
      url,
      { coordinates: [start, end] },
      {
        headers: {
          Authorization: ORS_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
    res.json(r.data); // features[0].geometry.coordinates
  } catch (e) {
    console.error('ORS failed:', e.response?.data || e.message);
    res.status(500).json({ error: 'ORS routing failed', details: e.response?.data || e.message });
  }
});

module.exports = router;
