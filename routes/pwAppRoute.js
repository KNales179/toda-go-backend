// routes/pwAppRoute.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const DriverStatus = require("../models/DriverStatus");
const DriverMeter = require("../models/DriverMeter");
const PwAppPassenger = require("../models/PwAppPassenger");

// Fare computation (adjust discount rates according to ordinance)
function computeFare(distanceMeters, passengerType) {
  const km = distanceMeters / 1000;
  let fare = 20; // first 2km

  if (km > 2) {
    fare += Math.ceil(km - 2) * 5;
  }

  const discountMap = {
    REGULAR: 0,
    STUDENT: 0.2,
    PWD: 0.2,
    SENIOR: 0.2,
  };
  const disc = discountMap[passengerType] ?? 0;

  fare = fare - fare * disc;
  return Math.round(fare);
}

// POST /api/pwapp/add
router.post("/pwapp/add", async (req, res) => {
  try {
    const { driverId, passengerType = "REGULAR", note = "" } = req.body;
    if (!driverId) return res.status(400).json({ ok: false, error: "driverId required" });

    // Make sure driver is online + has location
    const ds = await DriverStatus.findOne({ driverId: String(driverId) }).lean();
    if (!ds?.location) return res.status(400).json({ ok: false, error: "Driver location not found" });

    // ✅ ATOMIC capacity check + reserve 1 seat
    const seats = 1;
    const match = {
      driverId: new mongoose.Types.ObjectId(driverId),
      isOnline: true,
      lockedSolo: false,
      $expr: { $lte: ["$capacityUsed", { $subtract: ["$capacityTotal", seats] }] },
    };

    const reserved = await DriverStatus.findOneAndUpdate(
      match,
      { $inc: { capacityUsed: seats }, $set: { updatedAt: new Date() } },
      { new: true }
    ).lean();

    if (!reserved) {
      return res.status(409).json({ ok: false, error: "Capacity full (pwApp)" });
    }

    const meter = await DriverMeter.findOne({ driverId: String(driverId) }).lean();
    const startMeter = meter?.totalMeters ?? 0;

    const p = await PwAppPassenger.create({
      driverId: String(driverId),
      passengerType,
      note,
      pickupLat: Number(ds.location.latitude),
      pickupLng: Number(ds.location.longitude),
      startMeterMeters: startMeter,
      status: "ACTIVE",
    });

    return res.json({ ok: true, passenger: p });
  } catch (e) {
    console.error("pwapp add error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// GET /api/pwapp/active/:driverId
router.get("/pwapp/active/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    const list = await PwAppPassenger.find({ driverId: String(driverId), status: "ACTIVE" })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ ok: true, list });
  } catch (e) {
    console.error("pwapp active error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/pwapp/:id/dropoff
router.post("/pwapp/:id/dropoff", async (req, res) => {
  try {
    const { id } = req.params;

    const p = await PwAppPassenger.findById(id);
    if (!p) return res.status(404).json({ ok: false, error: "pwApp passenger not found" });
    if (p.status !== "ACTIVE") return res.status(409).json({ ok: false, error: "pwApp already closed" });

    const meter = await DriverMeter.findOne({ driverId: String(p.driverId) }).lean();
    const endMeter = meter?.totalMeters ?? p.startMeterMeters;

    const dist = Math.max(0, endMeter - p.startMeterMeters);
    const fare = computeFare(dist, p.passengerType);

    p.endMeterMeters = endMeter;
    p.distanceMeters = dist;
    p.computedFare = fare;
    p.status = "COMPLETED";
    p.completedAt = new Date();
    await p.save();

    // ✅ release seat
    try {
      await DriverStatus.updateOne(
        { driverId: new mongoose.Types.ObjectId(p.driverId) },
        { $inc: { capacityUsed: -1 }, $set: { updatedAt: new Date() } }
      );
    } catch (err) {
      console.error("pwapp dropoff seat release failed:", err);
    }

    return res.json({ ok: true, passenger: p });

    try {
      await DriverStatus.updateOne(
        { driverId: new mongoose.Types.ObjectId(p.driverId) },
        { $inc: { capacityUsed: -1 }, $set: { updatedAt: new Date() } }
      );
    } catch (err) {
      console.error("pwapp dropoff seat release failed:", err);
    }

    return res.json({ ok: true, passenger: p });
  } catch (e) {
    console.error("pwapp dropoff error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/driver-meter/reset -> reset when vehicle becomes empty (optional call)
router.post("/driver-meter/reset", async (req, res) => {
  try {
    const { driverId } = req.body;
    if (!driverId) return res.status(400).json({ ok: false, error: "driverId required" });

    await DriverMeter.updateOne(
      { driverId: String(driverId) },
      {
        $set: {
          totalMeters: 0,
          sessionId: `S-${Date.now()}`,
          lastUpdatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("meter reset error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
