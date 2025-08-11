const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/api/route', async (req, res) => {
  const { start, end } = req.body;
  if (!start || !end) return res.status(400).json({ error: "Missing start or end" });

  try {
    const r = await axios.post('https://api.openrouteservice.org/v2/directions/driving-car',
      { coordinates: [start, end] },
      { headers: { Authorization: process.env.ORS_API_KEY, 'Content-Type': 'application/json' } }
    );
    res.json(r.data);
  } catch (e) {
    console.error("ORS failed:", e.response?.data || e.message);
    res.status(500).json({ error: "ORS routing failed", details: e.response?.data || e.message });
  }
});

module.exports = router;
