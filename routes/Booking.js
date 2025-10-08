// routes/Booking.js (Mongo only — no in-memory array)
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const DriverStatus = require("../models/DriverStatus");
const Passenger = require("../models/Passenger");
const RideHistory = require("../models/RideHistory");
const Booking = require("../models/Bookings");

// ---------- helpers ----------
const toRad = (v) => (v * Math.PI) / 180;
const haversineMeters = (a, b) => {
  const EARTH_R_M = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(s));
};
const isObjectId = (s) => mongoose.Types.ObjectId.isValid(String(s || ""));

// ---------- POST /book ----------
router.post("/book", async (req, res) => {
  try {
    const {
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      fare,
      paymentMethod,
      notes,
      passengerId,
    } = req.body;

    if (
      ![pickupLat, pickupLng, destinationLat, destinationLng].every((n) =>
        Number.isFinite(Number(n))
      )
    ) {
      return res.status(400).json({ message: "Invalid coordinates" });
    }
    if (!passengerId) {
      return res.status(400).json({ message: "passengerId required" });
    }

    // Nice-to-have display name
    let passengerName = "Passenger";
    try {
      const p = await Passenger.findById(passengerId).select(
        "firstName middleName lastName"
      );
      if (p) {
        passengerName = [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(" ");
      }
    } catch {}

    const booking = await Booking.create({
      passengerId,
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      fare,
      paymentMethod,
      notes,
      status: "pending",
      passengerName,
    });

    // IMPORTANT: return id = bookingId for the app
    const plain = booking.toObject();
    return res.status(200).json({
      message: "Booking created. Waiting for a driver to accept.",
      booking: { ...plain, id: plain.bookingId },
    });
  } catch (error) {
    console.error("❌ Error during booking:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------- GET /waiting-bookings ----------
router.get("/waiting-bookings", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Math.max(0, Number(req.query.radiusKm ?? 5));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
    const driverId = req.query.driverId;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: "lat/lng required" });
    }

    if (driverId) {
      const status = await DriverStatus.findOne({ driverId }).lean();
      if (!status || !status.isOnline) {
        return res.status(403).json({ message: "Driver is offline" });
      }
    }

    const center = { lat, lng };
    const pending = await Booking.find({ status: "pending" }).lean();

    const out = pending
      .map((b) => {
        const distM = haversineMeters(center, {
          lat: Number(b.pickupLat),
          lng: Number(b.pickupLng),
        });
        return {
          // DHome expects 'id' here
          id: b.bookingId,
          pickup: { lat: b.pickupLat, lng: b.pickupLng },
          destination: { lat: b.destinationLat, lng: b.destinationLng },
          fare: b.fare,
          passengerPreview: { name: b.passengerName || "Passenger" },
          distanceKm: distM / 1000,
          createdAt: b.createdAt,
        };
      })
      .filter((r) => r.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limit);

    return res.status(200).json(out);
  } catch (e) {
    console.error("❌ waiting-bookings error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------- POST /accept-booking ----------
router.post("/accept-booking", async (req, res) => {
  try {
    const { bookingId, driverId } = req.body;
    if (!bookingId || !driverId) {
      return res
        .status(400)
        .json({ message: "bookingId and driverId are required" });
    }

    // Atomically claim only if still pending
    const doc = await Booking.findOneAndUpdate(
      { bookingId, status: "pending" },
      { $set: { status: "accepted", driverId } },
      { new: true }
    ).lean();

    if (!doc) {
      return res
        .status(409)
        .json({ message: "Booking not found or already accepted" });
    }

    return res.status(200).json({ message: "Booking accepted", booking: doc });
  } catch (e) {
    console.error("❌ accept-booking error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------- GET /driver-requests/:driverId ----------
router.get("/driver-requests/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    if (!driverId) {
      return res.status(400).json({ error: "driverId is required" });
    }

    // If stored as ObjectId in your schema, cast it; otherwise match string
    const match =
      isObjectId(driverId)
        ? { driverId: new mongoose.Types.ObjectId(driverId) }
        : { driverId: driverId };

    const rows = await Booking.find({
      ...match,
      status: { $in: ["pending", "accepted"] },
    }).lean();

    const sanitized = (rows || []).map((b) => ({
      // DHome expects id === bookingId
      id: String(b.bookingId || ""),
      status: b.status ?? "pending",
      driverId: b.driverId ? String(b.driverId) : "",
      passengerId: b.passengerId ? String(b.passengerId) : "",
      pickupLat: Number(b.pickupLat) || 0,
      pickupLng: Number(b.pickupLng) || 0,
      destinationLat: Number(b.destinationLat) || 0,
      destinationLng: Number(b.destinationLng) || 0,
      fare: Number(b.fare) || 0,
      paymentMethod: b.paymentMethod || "",
      notes: b.notes || "",
      passengerName: b.passengerName || "Passenger",
      createdAt: b.createdAt || new Date(),
    }));

    return res.status(200).json(sanitized);
  } catch (err) {
    console.error("❌ /driver-requests error:", err);
    return res
      .status(500)
      .json({ error: "Internal Server Error", message: err?.message || String(err) });
  }
});

// ---------- POST /driver-confirmed (optional legacy) ----------
router.post("/driver-confirmed", async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ message: "bookingId required" });

    const b = await Booking.findOneAndUpdate(
      { bookingId },
      { $set: { driverConfirmed: true } },
      { new: true }
    ).lean();

    if (!b) return res.status(404).json({ message: "Booking not found" });
    return res.status(200).json({ message: "Passenger notified!", booking: b });
  } catch (e) {
    console.error("❌ driver-confirmed error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------- POST /cancel-booking ----------
router.post("/cancel-booking", async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ message: "bookingId required" });

    const b = await Booking.findOneAndUpdate(
      { bookingId },
      { $set: { status: "canceled", cancelledBy: "passenger" } },
      { new: true }
    ).lean();

    if (!b) return res.status(404).json({ message: "Booking not found" });
    console.log("❌ Booking cancelled by passenger:", bookingId);
    return res.status(200).json({ message: "Booking cancelled", booking: b });
  } catch (e) {
    console.error("❌ cancel-booking error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------- POST /complete-booking ----------
router.post("/complete-booking", async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) {
      return res.status(400).json({ message: "bookingId required" });
    }

    const b = await Booking.findOneAndUpdate(
      { bookingId },
      { $set: { status: "completed" } },
      { new: true }
    );
    if (!b) return res.status(404).json({ message: "Booking not found" });

    // Save to ride history (best-effort)
    try {
      await RideHistory.create({
        bookingId: b.bookingId,
        passengerId: b.passengerId,
        driverId: b.driverId,
        pickupLat: b.pickupLat,
        pickupLng: b.pickupLng,
        destinationLat: b.destinationLat,
        destinationLng: b.destinationLng,
        fare: b.fare,
        paymentMethod: b.paymentMethod,
        notes: b.notes,
      });
    } catch (e) {
      console.error("❌ Error saving ride history:", e);
    }

    return res
      .status(200)
      .json({ message: "Booking marked as completed and history saved!", booking: b });
  } catch (e) {
    console.error("❌ complete-booking error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------- (Optional) GET /bookings — debug only ----------
router.get("/bookings", async (_req, res) => {
  try {
    const rows = await Booking.find({}).sort({ createdAt: -1 }).lean();
    return res.status(200).json(
      rows.map((b) => ({ ...b, id: b.bookingId })) // mirror 'id' for clients that read this
    );
  } catch (e) {
    console.error("❌ list bookings error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
