const express = require('express');
const router = express.Router();
const Report = require('../models/Report');

router.get('/reports', async (req, res) => {
  try {
    const reports = await Report.find().sort({ submittedAt: -1 });
    res.json(reports);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
