const express = require('express');
const router = express.Router();
const Driver = require('../models/Drivers');
const Passenger = require('../models/Passenger');

router.get('/counts', async (req, res) => {
  try {
    const driverCount = await Driver.countDocuments();
    const passengerCount = await Passenger.countDocuments();
    res.json({ driverCount, passengerCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch counts' });
  }
});

module.exports = router;
