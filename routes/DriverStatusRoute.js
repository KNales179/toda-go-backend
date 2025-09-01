const express = require('express');
const router = express.Router();
const DriverStatus = require('../models/DriverStatus');

// POST /api/driver-status ➜ toggle Online/Offline
router.post('/driver-status', async (req, res) => {
  try {
    const { driverId, isOnline, location } = req.body;
    if (!driverId) return res.status(400).json({ error: 'driverId is required' });

    if (isOnline === true) {
      // Driver goes online
      const status = await DriverStatus.findOneAndUpdate(
        { driverId },
        { isOnline: true, location, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      return res.status(200).json({ message: 'Driver is online', status });
    } else {
      // Driver goes offline explicitly
      const status = await DriverStatus.findOneAndUpdate(
        { driverId },
        { isOnline: false, updatedAt: new Date() },
        { upsert: true, new: true }
      );
      return res.status(200).json({ message: 'Driver is offline', status });
    }
  } catch (err) {
    console.error('❌ Error toggling driver status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/driver-heartbeat ➜ extend life while app is running
router.post('/driver-heartbeat', async (req, res) => {
  try {
    const { driverId, location } = req.body;
    if (!driverId) return res.status(400).json({ error: 'driverId is required' });
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return res.status(400).json({ error: 'location {lat,lng} required' });
    }

    const status = await DriverStatus.findOneAndUpdate(
      { driverId },
      { location, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    return res.status(200).json({ ok: true, updatedAt: status.updatedAt });
  } catch (err) {
    console.error('❌ Heartbeat error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/driver-status/:driverId ➜ check if driver is effectively online
router.get('/driver-status/:driverId', async (req, res) => {
  try {
    const status = await DriverStatus.findOne({ driverId: req.params.driverId });
    if (!status) {
      return res.status(404).json({ message: 'Driver status not found' });
    }

    const now = Date.now();
    // Driver is "online" only if flag is true AND last heartbeat was within 60s
    const effectiveOnline =
      status.isOnline && now - new Date(status.updatedAt).getTime() < 60_000;

    res.status(200).json({
      location: status.location,
      isOnline: effectiveOnline,
      updatedAt: status.updatedAt,
    });
  } catch (err) {
    console.error('❌ Error fetching driver status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
