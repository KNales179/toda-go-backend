const express = require("express");
const router = express.Router();
const RideHistory = require("../models/RideHistory");

// GET /api/rides ➜ fetch all ride history
router.get("/rides", async (req, res) => {
  try {
    const rides = await RideHistory.find().sort({ completedAt: -1 }); // sort by most recent
    res.status(200).json(rides);
  } catch (error) {
    console.error("❌ Failed to fetch ride history:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
