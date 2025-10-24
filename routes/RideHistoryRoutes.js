// routes/RideHistory.js
const express = require("express");
const router = express.Router();
const RideHistory = require("../models/RideHistory");

/* ADMIN: all rides (unchanged) */
router.get("/rides", async (req, res) => {
  try {
    const rides = await RideHistory.find().sort({ completedAt: -1 });
    res.status(200).json(rides);
  } catch (e) {
    console.error("❌ all rides error", e);
    res.status(500).json({ message: "Server error" });
  }
});

/* USER: history (no pagination, no limit) */
router.get("/ridehistory", async (req, res) => {
  try {
    const { passengerId = "", driverId = "" } = req.query;
    const filter = {};
    if (passengerId) filter.passengerId = String(passengerId).trim();
    if (driverId) filter.driverId = String(driverId).trim();

    const rides = await RideHistory.find(filter)
      .sort({ completedAt: -1, _id: -1 })
      .lean();

    const items = rides.map((r) => ({
      _id: String(r._id),
      bookingId: r.bookingId,
      passengerId: r.passengerId,
      driverId: r.driverId,
      pickupLabel:
        r.pickupLat != null && r.pickupLng != null
          ? `${r.pickupLat.toFixed(5)}, ${r.pickupLng.toFixed(5)}`
          : "Pickup",
      destinationLabel:
        r.destinationLat != null && r.destinationLng != null
          ? `${r.destinationLat.toFixed(5)}, ${r.destinationLng.toFixed(5)}`
          : "Destination",
      fare: r.fare || 0,
      paymentMethod: r.paymentMethod || "",
      notes: r.notes || "",
      createdAt: r.completedAt || r.createdAt || new Date(),
    }));

    res.json({ items, total: items.length });
  } catch (e) {
    console.error("❌ ridehistory error", e);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
