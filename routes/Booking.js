// routes/Booking.js (queue model: pending → accept)
const express = require('express');
const router = express.Router();
const DriverStatus = require("../models/DriverStatus");
const Passenger = require("../models/Passenger");
const RideHistory = require("../models/RideHistory");

// In-memory store (unchanged for now)
let bookings = [];

// --- Haversine helpers ---
const toRad = (v) => (v * Math.PI) / 180;
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
router.post('/book', async (req, res) => {
  try {
    const {
      pickupLat, pickupLng,
      destinationLat, destinationLng,
      fare, paymentMethod, notes, passengerId,
    } = req.body;

    // Fetch nice-to-have passenger name
    let passengerName = "Anonymous";
    try {
      const p = await Passenger.findById(passengerId).select("firstName middleName lastName");
      if (p) passengerName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
    } catch {}

    const bookingId = bookings.length + 1;
    const bookingData = {
      id: bookingId,
      pickupLat, pickupLng,
      destinationLat, destinationLng,
      fare, paymentMethod, notes,
      passengerName,
      passengerId: passengerId || null,
      driverId: null,
      status: "pending",
      createdAt: new Date(),
      chat: [], // 💬 store chat messages here
    };
    bookings.push(bookingData);

    return res.status(200).json({
      message: "Booking created. Waiting for a driver to accept.",
      booking: bookingData
    });
  } catch (error) {
    console.error("❌ Error during booking:", error);
    return res.status(500).json({ message: "Server error" });
  }
});


async function isDriverEffectivelyOnline(driverId) {
  if (!driverId) return false;
  const status = await DriverStatus.findOne({ driverId });
  if (!status) return false;
  const last = new Date(status.updatedAt).getTime();
  return Boolean(status.isOnline) && (Date.now() - last < 60_000);
}


// --- DRIVER QUEUE: nearby pending bookings ---
router.get('/waiting-bookings', async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radiusKm = Math.max(0, Number(req.query.radiusKm ?? 5));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
    const driverId = req.query.driverId; // optional

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: "lat/lng required" });
    }

    // If driverId provided, require that driver is effectively online
    if (driverId) {
      const ok = await isDriverEffectivelyOnline(driverId);
      if (!ok) return res.status(403).json({ message: "Driver is offline" });
    }

    const center = { lat, lng };
    const out = bookings
      .filter(b => b && b.status === "pending")
      .map(b => {
        const distM = haversineMeters(center, { lat: b.pickupLat, lng: b.pickupLng });
        return {
          id: b.id,
          pickup: { lat: b.pickupLat, lng: b.pickupLng },
          destination: { lat: b.destinationLat, lng: b.destinationLng },
          fare: b.fare,
          passengerPreview: { name: b.passengerName },
          distanceKm: distM / 1000,
          createdAt: b.createdAt,
        };
      })
      .filter(r => r.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm || a.id - b.id)
      .slice(0, limit);

    return res.status(200).json(out);
  } catch (e) {
    console.error("❌ waiting-bookings error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});


// --- ACCEPT: require driverId + guard pending ---
router.post('/accept-booking', async (req, res) => {
  try {
    const { bookingId, driverId } = req.body;
    const id = Number(bookingId);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid bookingId" });
    if (!driverId) return res.status(400).json({ message: "driverId required" });

    // Guard: driver must be effectively online (isOnline && heartbeat < 60s)
    const ok = await isDriverEffectivelyOnline(driverId);
    if (!ok) {
      return res.status(409).json({ message: "Cannot accept: driver is offline (no recent heartbeat)" });
    }

    const booking = bookings.find(b => b.id === id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    if (booking.status !== "pending") {
      return res.status(409).json({ message: `Cannot accept. Current status: ${booking.status}` });
    }

    booking.driverId = String(driverId);
    booking.status = "accepted";

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

router.get('/driver-requests/:driverId', (req, res) => {
  const { driverId } = req.params;
  const driverBookings = bookings.filter(
    (b) => String(b.driverId) === String(driverId) &&
           (b.status === "pending" || b.status === "accepted")
  );
  res.status(200).json(driverBookings);
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
