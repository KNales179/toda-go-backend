const express = require('express');
const router = express.Router();
const BlockedRoad = require('../models/BlockedRoad');

// POST /api/blocked-roads
router.post('/blocked-roads', async (req, res) => {
  try {
    const { start, end, reason } = req.body;

    const blocked = new BlockedRoad({ start, end, reason });
    await blocked.save();

    res.status(201).json({ success: true, message: 'Blocked road saved', data: blocked });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Error saving blocked road', error: err.message });
  }
});

module.exports = router;
