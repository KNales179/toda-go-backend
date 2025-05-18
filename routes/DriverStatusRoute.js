const express = require('express');
const router = express.Router();
const DriverStatus = require('../models/DriverStatus');

// POST /api/driver-status ➜ update or create status
router.post('/driver-status', async (req, res) => {
  try {
    const { driverId, isOnline, location } = req.body;

    const status = await DriverStatus.findOneAndUpdate(
      { driverId },
      { isOnline, location, updatedAt: new Date() },
      { upsert: true, new: true }
    );

    console.log('✅ Driver status updated:', status);
    res.status(200).json({ message: 'Status updated', status });
  } catch (err) {
    console.error('❌ Error updating driver status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/driver-status/:driverId ➜ fetch driver's latest location
router.get('/driver-status/:driverId', async (req, res) => {
  try {
    const status = await DriverStatus.findOne({ driverId: req.params.driverId });

    if (!status) {
      return res.status(404).json({ message: 'Driver status not found' });
    }

    res.status(200).json({
      location: status.location,
      isOnline: status.isOnline,
      updatedAt: status.updatedAt,
    });
  } catch (err) {
    console.error('❌ Error fetching driver status:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
