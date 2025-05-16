// routes/IntersectionRoutes.js

const express = require('express');
const router = express.Router();
const Intersection = require('../models/Intersection');

// Add an Intersection
router.post('/add-intersection', async (req, res) => {
  try {
    const { lat, lng, roadNames } = req.body;

    const newIntersection = new Intersection({ lat, lng, roadNames });
    await newIntersection.save();

    res.status(201).json({ message: 'Intersection added successfully', intersection: newIntersection });
  } catch (error) {
    res.status(500).json({ message: 'Failed to add intersection', error: error.message });
  }
});

// Get All Intersections
router.get('/get-intersections', async (req, res) => {
  try {
    const intersections = await Intersection.find();
    res.status(200).json(intersections);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch intersections', error: error.message });
  }
});

module.exports = router;
