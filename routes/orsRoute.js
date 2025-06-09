// In your Express backend
const express = require('express');
const router = express.Router();
const axios = require('axios');

router.post('/api/route', async (req, res) => {
  const { start, end } = req.body;

  try {
    const orsResponse = await axios.post(
      'https://api.openrouteservice.org/v2/directions/driving-car',
      {
        coordinates: [start, end]
      },
      {
        headers: {
          Authorization: '5b3ce3597851110001cf6248f75f03b0fa3b4bebaaefb0f0e7ca97f3',
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(orsResponse.data);
  } catch (error) {
    console.error('ORS error:', error.message);
    res.status(500).json({ error: 'Failed to get route from ORS' });
  }
});

module.exports = router;
