// routes/pwAppRoute.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const DriverStatus = require("../models/DriverStatus");
const DriverMeter = require("../models/DriverMeter");
const PwAppPassenger = require("../models/PwAppPassenger");

// Fare computation breakdown
function computeFareBreakdown(distanceMeters, passengerType) {
  const km = distanceMeters / 1000;

  const baseFare = 20; // first 2km
  const baseKm = 2;
  const perKm = 5;

  const extraKmRaw = Math.max(0, km - baseKm);
  const extraKmCharged = Math.ceil(extraKmRaw);
  const extraFare = extraKmCharged * perKm;

  const subtotal = baseFare + extraFare;

  const discountMap = { REGULAR: 0, STUDENT: 0.2, PWD: 0.2, SENIOR: 0.2 };
  const discountRate = discountMap[String(passengerType || "").toUpperCase()] ?? 0;

  const discountAmount = subtotal * discountRate;
  const total = Math.round(subtotal - discountAmount);

  return {
    distanceMeters,
    distanceKm: Number(km.toFixed(3)),
    baseFare,
    baseKm,
    perKm,
    extraKmCharged,
    extraFare,
    subtotal,
    discountRate,
    discountAmount: Math.round(discountAmount),
    total,
  };
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
      passengerType: String(passengerType).toUpperCase(),
      note,
      pickupLat: Number(ds.location.latitude),
      pickupLng: Number(ds.location.longitude),
      startMeterMeters: startMeter,
      status: "ACTIVE",
    });

    return res.json({ ok: true, passenger: p });
  } catch (e) {
    console.error("Passenger add error:", e);
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
    if (!p) return res.status(404).json({ ok: false, error: "passenger not found" });
    if (p.status !== "ACTIVE") return res.status(409).json({ ok: false, error: "already closed" });

    const meter = await DriverMeter.findOne({ driverId: String(p.driverId) }).lean();
    const endMeter = meter?.totalMeters ?? p.startMeterMeters;

    const dist = Math.max(0, endMeter - (p.startMeterMeters || 0));
    const breakdown = computeFareBreakdown(dist, p.passengerType);

    p.endMeterMeters = endMeter;
    p.distanceMeters = dist;
    p.computedFare = breakdown.total;
    p.fareBreakdown = breakdown;
    p.status = "COMPLETED";
    p.completedAt = new Date();
    await p.save();

    // ✅ release exactly 1 seat (only once)
    try {
      await DriverStatus.updateOne(
        { driverId: new mongoose.Types.ObjectId(p.driverId) },
        { $inc: { capacityUsed: -1 }, $set: { updatedAt: new Date() } }
      );
    } catch (err) {
      console.error("Passenger dropoff seat release failed:", err);
    }

    return res.json({ ok: true, passenger: p });
  } catch (e) {
    console.error("Passenger dropoff error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/driver-meter/reset (optional)
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