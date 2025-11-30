// routes/liveMonitor.js
const express = require("express");
const router = express.Router();

const Toda = require("../models/Toda");
const Driver = require("../models/Driver");
const DriverStatus = require("../models/DriverStatus");
const Booking = require("../models/Bookings");

router.get("/toda/locations", async (req, res) => {
  try {
    const todas = await Toda.find({ isActive: true }).lean();

    const payload = todas.map((t) => ({
      id: t._id,
      name: t.name,
      latitude: t.latitude,
      longitude: t.longitude,
      street: t.street || "",
      barangay: t.barangay || "",
      city: t.city || "Lucena City",
      notes: t.notes || "",
      // use schema radius if set, otherwise fallback to 100m for monitor
      radiusMeters: t.radiusMeters && t.radiusMeters > 0 ? t.radiusMeters : 100,
    }));

    res.json(payload);
  } catch (err) {
    console.error("Error in /api/toda/locations:", err);
    res.status(500).json({ error: "Failed to load TODA locations" });
  }
});

/**
 * GET /api/drivers/active
 * Online drivers + basic info for monitor.
 */
router.get("/drivers/active", async (req, res) => {
  try {
    const statuses = await DriverStatus.find({ isOnline: true })
      .populate("driverId") // pulls from Driver model
      .lean();

    const payload = statuses
      .filter((s) => s.location && s.location.latitude && s.location.longitude)
      .map((s) => {
        const d = s.driverId || {};
        return {
          id: d._id,
          driverId: d._id,           // explicit id
          name: d.driverName,
          franchiseNumber: d.franchiseNumber,
          todaName: d.todaName,
          sector: d.sector,
          phone: d.driverPhone,
          rating: d.rating ?? 0,
          ratingCount: d.ratingCount ?? 0,
          capacityTotal: s.capacityTotal,
          capacityUsed: s.capacityUsed,
          lockedSolo: s.lockedSolo,
          isOnline: s.isOnline,
          // map location
          latitude: s.location.latitude,
          longitude: s.location.longitude,
          // “has job” if status has any activeBookingIds
          hasJob: Array.isArray(s.activeBookingIds) && s.activeBookingIds.length > 0,
          activeBookingIds: s.activeBookingIds || [],
          currentTodaId: s.currentTodaId || null,
          inTodaZone: !!s.inTodaZone,
          updatedAt: s.updatedAt,
        };
      });

    res.json(payload);
  } catch (err) {
    console.error("Error in /api/drivers/active:", err);
    res.status(500).json({ error: "Failed to load active drivers" });
  }
});

/**
 * GET /api/bookings/active
 * All bookings that are not completed/canceled.
 */
router.get("/bookings/active", async (req, res) => {
  try {
    const activeStatuses = ["pending", "accepted", "enroute"];

    const bookings = await Booking.find({
      status: { $in: activeStatuses },
    })
      .sort({ createdAt: -1 })
      .lean();

    const payload = bookings.map((b) => ({
      id: b._id,
      bookingId: b.bookingId,
      status: b.status,
      passengerId: b.passengerId,
      passengerName: b.passengerName || "Passenger",
      driverId: b.driverId || null,

      pickupLat: b.pickupLat,
      pickupLng: b.pickupLng,
      destinationLat: b.destinationLat,
      destinationLng: b.destinationLng,
      pickupPlace: b.pickupPlace,
      destinationPlace: b.destinationPlace,

      fare: b.fare,
      paymentMethod: b.paymentMethod,
      notes: b.notes,

      pickupTodaId: b.pickupTodaId,
      destinationTodaId: b.destinationTodaId,
      passengerZoneTag: b.passengerZoneTag,

      createdAt: b.createdAt,
      acceptedAt: b.acceptedAt,
      completedAt: b.completedAt,
    }));

    res.json(payload);
  } catch (err) {
    console.error("Error in /api/bookings/active:", err);
    res.status(500).json({ error: "Failed to load active bookings" });
  }
});

module.exports = router;
