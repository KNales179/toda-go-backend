// routes/Booking.js (queue model: pending → accept)
const express = require('express');
const router = express.Router();
const DriverStatus = require("../models/DriverStatus");
const Passenger = require("../models/Passenger");
const RideHistory = require("../models/RideHistory");
const Booking = require("../models/Bookings");

// --- Haversine helpers ---
const toRad = (v) => (v * Math.PI) / 180;
const isObjectId = (s) => mongoose.Types.ObjectId.isValid(String(s || ""));
const EARTH_R_M = 6371000;
const haversineMeters = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(s));
};

// --- BOOK: create pending only (no auto-assign) ---
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

    // Fetch nice-to-have passenger name
    let passengerName = "Anonymous";
    try {
      const p = await Passenger.findById(passengerId).select(
        "firstName middleName lastName"
      );
      if (p)
        passengerName = [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(" ");
    } catch {}

    const booking = new Booking({
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

    await booking.save();

    return res.status(200).json({
      message: "Booking created. Waiting for a driver to accept.",
      booking,
    });
  } catch (error) {
    console.error("❌ Error during booking:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// --- DRIVER QUEUE: nearby pending bookings ---
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
      const status = await DriverStatus.findOne({ driverId });
      if (!status || !status.isOnline) {
        return res.status(403).json({ message: "Driver is offline" });
      }
    }

    const center = { lat, lng };
    const bookings = await Booking.find({ status: "pending" }).lean();

    const out = bookings
      .map((b) => {
        const distM = haversineMeters(center, {
          lat: b.pickupLat,
          lng: b.pickupLng,
        });
        return {
          bookingId: b.bookingId,
          pickup: { lat: b.pickupLat, lng: b.pickupLng },
          destination: { lat: b.destinationLat, lng: b.destinationLng },
          fare: b.fare,
          passengerPreview: { name: b.passengerName },
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

// --- ACCEPT BOOKING ---
router.post("/accept-booking", async (req, res) => {
  try {
    const { bookingId, driverId } = req.body;

    if (!bookingId) return res.status(400).json({ message: "bookingId required" });
    if (!driverId) return res.status(400).json({ message: "driverId required" });

    const booking = await Booking.findOne({ bookingId });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.status !== "pending") {
      return res
        .status(409)
        .json({ message: `Cannot accept. Current status: ${booking.status}` });
    }

    booking.driverId = driverId;
    booking.status = "accepted";
    await booking.save();

    return res.status(200).json({ message: "Booking accepted", booking });
  } catch (e) {
    console.error("❌ accept-booking error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});



// --- CHAT ENDPOINTS ---
// Fetch messages for a booking
router.get('/bookings/:id/chat', (req, res) => {
  const id = Number(req.params.id);
  const booking = bookings.find(b => b.id === id);
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  return res.status(200).json(booking.chat);
});

// Post a new message to chat
router.post('/bookings/:id/chat', (req, res) => {
  const id = Number(req.params.id);
  const { sender, text } = req.body;
  const booking = bookings.find(b => b.id === id);
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  if (!sender || !text) return res.status(400).json({ message: "sender and text required" });

  const msg = { sender, text, ts: new Date() };
  booking.chat.push(msg);
  return res.status(200).json({ message: "Message added", chat: booking.chat });
});


// --- Existing helpers/endpoints (kept) ---
router.get('/bookings', (req, res) => res.status(200).json(bookings));

// routes/Booking.js (or wherever this is)
router.get("/driver-requests/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!driverId) {
      return res.status(400).json({ error: "driverId is required" });
    }
    const match = isObjectId(driverId)
      ? { driverId: new mongoose.Types.ObjectId(driverId) }
      : { driverId: driverId }; // if stored as string

    const driverBookings = await Booking.find({
      ...match,
      status: { $in: ["pending", "accepted"] },
    }).lean();

    const sanitized = (driverBookings || []).map((b) => ({
      id: String(b._id ?? b.id ?? ""),
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


router.post('/driver-confirmed', (req, res) => {
  const { bookingId } = req.body;
  const booking = bookings.find(b => b.id === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  booking.driverConfirmed = true;
  return res.status(200).json({ message: "Passenger notified!", booking });
});

router.post('/cancel-booking', (req, res) => {
  const { bookingId } = req.body;
  const booking = bookings.find(b => b.id === bookingId);
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  booking.status = "cancelled";
  booking.cancelledBy = "passenger";
  console.log("❌ Booking cancelled by passenger:", bookingId);
  res.status(200).json({ message: "Booking cancelled" });
});

router.post('/clear-bookings', (req, res) => {
  bookings = [];
  console.log("🧹 All bookings cleared.");
  res.status(200).json({ message: "All bookings cleared." });
});

router.post('/complete-booking', (req, res) => {
  const { bookingId, id: idAlt } = req.body;
  const id = Number(bookingId ?? idAlt);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid bookingId" });
  }
  const booking = bookings.find(b => b.id === id);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  booking.status = "completed";

  const rideHistory = new RideHistory({
    bookingId: booking.id,
    passengerId: booking.passengerId,
    driverId: booking.driverId,
    pickupLat: booking.pickupLat,
    pickupLng: booking.pickupLng,
    destinationLat: booking.destinationLat,
    destinationLng: booking.destinationLng,
    fare: booking.fare,
    paymentMethod: booking.paymentMethod,
    notes: booking.notes,
  });

  rideHistory.save()
    .then(() => res.status(200).json({ message: "Booking marked as completed and history saved!" }))
    .catch((err) => {
      console.error("❌ Error saving ride history:", err);
      res.status(500).json({ message: "Server error while saving ride history" });
    });
});

module.exports = router;
