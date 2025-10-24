// routes/RideHistory.js
const express = require("express");
const router = express.Router();
const RideHistory = require("../models/RideHistory");

// Optional: simple request logger (keeps it local to this file)
router.use((req, _res, next) => {
  console.log(`🛰️  [RideHistory] ${req.method} ${req.originalUrl}`);
  next();
});

/* ADMIN — all rides */
router.get("/rides", async (req, res) => {
  const t0 = Date.now();
  try {
    const rides = await RideHistory.find().sort({ completedAt: -1 }).lean();
    if (rides.length > 0) {
      console.log("🧩 sample[0]:", {
        _id: String(rides[0]._id),
        passengerId: rides[0].passengerId,
        driverId: rides[0].driverId,
        fare: rides[0].fare,
        completedAt: rides[0].completedAt,
      });
    }
    res.status(200).json(rides);
  } catch (error) {
    console.error("❌ /rides error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* PASSENGER/DRIVER — filtered, no pagination */
router.get("/ridehistory", async (req, res) => {
  const t0 = Date.now();
  try {
    const { passengerId = "", driverId = "" } = req.query;
    const filter = {};
    if (passengerId) filter.passengerId = String(passengerId).trim();
    if (driverId) filter.driverId = String(driverId).trim();

  
    const rides = await RideHistory.find(filter)
      .sort({ completedAt: -1, _id: -1 })
      .lean();

    if (rides.length > 0) {
      console.log("🧩 sample[0]:", {
        _id: String(rides[0]._id),
        passengerId: rides[0].passengerId,
        driverId: rides[0].driverId,
        fare: rides[0].fare,
        completedAt: rides[0].completedAt,
      });
    }

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
  } catch (error) {
    console.error("❌ /ridehistory error:", error);
    res.status(500).json({ error: "server_error" });
  }
});
router.delete("/ridehistory/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await RideHistory.findByIdAndDelete(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/ridehistory/:id/report", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = "" } = req.body || {};
    console.log("⚠️ Report ride:", id, "reason:", reason);
    // Optionally: save to a separate Report collection
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
