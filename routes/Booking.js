const express = require('express');
const router = express.Router();
const DriverStatus = require("../models/DriverStatus");
const Passenger = require("../models/Passenger");
const RideHistory = require("../models/RideHistory");
const { haversineMeters } = require('../utils/haversine');

let bookings = [];

router.post('/book', async (req, res) => {
  try {
    const {
      pickupLat, pickupLng,
      destinationLat, destinationLng,
      fare, paymentMethod, notes, passengerId,
    } = req.body;

    // Get passenger name for record-keeping
    let passengerName = "Anonymous";
    try {
      const passenger = await Passenger.findById(passengerId).select("firstName middleName lastName");
      if (passenger) {
        passengerName = [passenger.firstName, passenger.middleName, passenger.lastName]
          .filter(Boolean).join(" ");
      }
    } catch { /* ignore */ }

    const bookingId = bookings.length + 1;
    const bookingData = {
      id: bookingId,
      pickupLat, pickupLng,
      destinationLat, destinationLng,
      fare, paymentMethod, notes,
      passengerName,
      passengerId,
      driverId: null,
      status: "pending",
      createdAt: new Date(),
    };
    bookings.push(bookingData);

    return res.status(201).json({
      message: "Booking created (pending). Waiting for a driver to accept.",
      booking: bookingData,
    });
  } catch (error) {
    console.error("❌ Error during booking:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get('/waiting-bookings', (req, res) => {
  const { lat, lng, radiusKm = '5', limit = '20', freshnessMin = '15' } = req.query;

  const center = { lat: Number(lat), lng: Number(lng) };
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
    return res.status(400).json({ message: "lat and lng query params are required." });
  }

  const radiusMeters = Number(radiusKm) * 1000;
  const freshCutoff = Date.now() - Number(freshnessMin) * 60 * 1000;

  const items = bookings
    .filter(b =>
      b.status === 'pending' &&
      new Date(b.createdAt).getTime() >= freshCutoff
    )
    .map(b => {
      const distM = haversineMeters(center, { lat: b.pickupLat, lng: b.pickupLng });
      return {
        id: b.id,
        distanceKm: distM / 1000,
        pickup: { lat: b.pickupLat, lng: b.pickupLng },
        destination: { lat: b.destinationLat, lng: b.destinationLng },
        fare: b.fare,
        passengerPreview: { name: b.passengerName || "Anonymous" },
        createdAt: b.createdAt,
      };
    })
    .filter(x => x.distanceKm * 1000 <= radiusMeters)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, Number(limit));

  return res.status(200).json(items);
});


// Other endpoints (unchanged):
router.get('/bookings', (req, res) => res.status(200).json(bookings));

router.get('/driver-requests/:driverId', (req, res) => {
  const { driverId } = req.params;
  const driverBookings = bookings.filter(
    (b) => String(b.driverId) === driverId && (b.status === "pending" || b.status === "accepted")
  );
  res.status(200).json(driverBookings);
});

router.post('/accept-booking', (req, res) => {
  const { bookingId, driverId } = req.body;
  const id = Number(bookingId);

  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid bookingId" });
  }
  if (!driverId) {
    return res.status(400).json({ message: "driverId is required" });
  }

  const booking = bookings.find((b) => b.id === id);
  if (!booking) return res.status(404).json({ message: "Booking not found" });

  if (booking.status !== 'pending') {
    return res.status(409).json({ message: "Already taken or not pending" });
  }

  booking.status = "accepted";
  booking.driverId = String(driverId);
  booking.acceptedAt = new Date();

  return res.status(200).json({ message: "Booking accepted", booking });
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
  const { bookingId, id: idAlt } = req.body;     // allow both keys
  const id = Number(bookingId ?? idAlt);         // ✅ coerce
  if (!Number.isFinite(id)) {
    return res.status(400).json({ message: "Invalid bookingId" });
  }

  const booking = bookings.find(b => b.id === id);
  if (!booking) {
    return res.status(404).json({ message: "Booking not found" });
  }

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
