const express = require("express");
const router = express.Router();
const DriverStatus = require("../models/DriverStatus");

// GET /api/driver-status/:driverId
router.get("/driver-status/:driverId", async (req, res) => {
  try {
    const status = await DriverStatus.findOne({ driverId: req.params.driverId });

    if (!status) {
      return res.status(404).json({ message: "Driver status not found" });
    }

    res.status(200).json({
      location: status.location,
      isOnline: status.isOnline,
      updatedAt: status.updatedAt,
    });
  } catch (err) {
    console.error("❌ Failed to fetch driver status:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
