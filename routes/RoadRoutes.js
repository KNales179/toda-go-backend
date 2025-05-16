// routes/RoadRoutes.js

const express = require('express');
const router = express.Router();
const Road = require('../models/Road');

// Add Road
router.post('/add-road', async (req, res) => {
  try {
    const { roadName, path, oneWay, allowedForTricycle } = req.body;

    if (!roadName || !path || path.length < 2) {
      return res.status(400).json({ message: "Invalid road data" });
    }

    const newRoad = new Road({
      roadName,
      path,
      oneWay,
      allowedForTricycle,
    });

    await newRoad.save();

    res.status(201).json({ message: "Road saved successfully", road: newRoad });
  } catch (error) {
    res.status(500).json({ message: "Failed to save road", error: error.message });
  }
});

// Get all Roads
router.get('/get-roads', async (req, res) => {
  try {
    const roads = await Road.find();
    res.status(200).json(roads);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch roads', error: error.message });
  }
});

module.exports = router;
