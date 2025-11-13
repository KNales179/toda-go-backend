// routes/Booking.js (Mongo-only)
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const DriverStatus = require("../models/DriverStatus");
const Passenger = require("../models/Passenger");
const RideHistory = require("../models/RideHistory");
const Booking = require("../models/Bookings");
const Driver = require("../models/Drivers");


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

function haversine(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

// Config
const RESERVATION_SECONDS = null;

async function pickNearestDriver({ pickupLat, pickupLng, bookingType, partySize }) {
  // Only drivers that are online
  const online = await DriverStatus.find({ online: true }).lean();

  let best = null;
  for (const d of online) {
    if (!d.location || d.location.latitude == null || d.location.longitude == null) continue;

    // Capacity rules (you can customize)
    const capTotal = d.capacityTotal ?? 4;
    const capUsed  = d.capacityUsed  ?? 0;
    const free = capTotal - capUsed;

    if (bookingType === "SOLO" && d.lockedSolo) continue; // driver locked to a VIP already
    if (bookingType === "GROUP" && free < Math.max(2, Number(partySize) || 2)) continue;
    if (bookingType === "CLASSIC" && free < 1) continue;

    const dist = haversine(
      pickupLat, pickupLng,
      d.location.latitude, d.location.longitude
    );

    if (!best || dist < best.dist) best = { dist, driver: d };
  }

  return best?.driver || null;
}


// --- Capacity utils ---
async function getDriverStatusOrInit(driverId) {
  let ds = await DriverStatus.findOne({ driverId }).lean();
  if (!ds) {
    // Initialize with safe defaults
    ds = (await DriverStatus.create({
      driverId,
      isOnline: false,
      capacityTotal: 4,
      capacityUsed: 0,
      lockedSolo: false,
      activeBookingIds: [],
    })).toObject();
  } else if (typeof ds.capacityTotal !== "number") {
    // Backfill old docs
    await DriverStatus.updateOne(
      { driverId },
      { $set: { capacityTotal: 4, capacityUsed: ds.capacityUsed || 0, lockedSolo: !!ds.lockedSolo } }
    );
    ds.capacityTotal = 4;
    ds.capacityUsed = ds.capacityUsed || 0;
    ds.lockedSolo = !!ds.lockedSolo;
  }
  return ds;
}

function fitsCapacity(booking, ds) {
  const seats = Number(booking?.reservedSeats || booking?.partySize || 1);
  const total = Number(ds.capacityTotal || 4);
  const used = Number(ds.capacityUsed || 0);
  const remaining = total - used;

  if (booking.bookingType === "SOLO") {
    // SOLO only if empty and not locked
    return !ds.lockedSolo && used === 0;
  }
  // CLASSIC/GROUP
  return !ds.lockedSolo && remaining >= seats;
}

async function reserveSeatsAtomic({ driverId, booking }) {
  const seats = Number(booking?.reservedSeats || booking?.partySize || 1);

  // First try to increment DriverStatus if capacity allows
  const match = {
    driverId: new mongoose.Types.ObjectId(driverId),
    isOnline: true,
    // For SOLO: must be empty and not locked
    ...(booking.bookingType === "SOLO"
      ? { capacityUsed: { $eq: 0 }, lockedSolo: false }
      : { lockedSolo: false, $expr: { $lte: ["$capacityUsed", { $subtract: ["$capacityTotal", seats] }] } }),
  };

  const update = {
    $inc: { capacityUsed: seats },
    $set: { updatedAt: new Date() },
    ...(booking.bookingType === "SOLO" ? { $setOnInsert: {}, $set: { lockedSolo: true } } : {}),
    ...(booking.bookingId ? { $addToSet: { activeBookingIds: String(booking.bookingId) } } : {}),
  };

  const ds = await DriverStatus.findOneAndUpdate(match, update, { new: true }).lean();

  if (!ds) {
    // capacity/lock condition failed
    return { ok: false, reason: "capacity_or_lock" };
  }

  // Now atomically claim booking if still pending
  const claimed = await Booking.findOneAndUpdate(
    { bookingId: booking.bookingId, status: "pending" },
    {
      $set: {
        status: "accepted",
        driverId: String(driverId),
        driverLock: booking.bookingType === "SOLO",
      },
    },
    { new: true }
  ).lean();

  if (!claimed) {
    // Rollback driver seat increment
    const rb = {
      $inc: { capacityUsed: -seats },
      $pull: { activeBookingIds: String(booking.bookingId) },
      $set: { updatedAt: new Date() },
    };
    if (booking.bookingType === "SOLO") rb.$set.lockedSolo = false;
    await DriverStatus.updateOne({ driverId }, rb);
    return { ok: false, reason: "booking_already_taken" };
  }

  return { ok: true, booking: claimed, driverStatus: ds };
}

async function releaseSeats({ driverId, booking, reason = "release" }) {
  if (!driverId || !booking) return;

  const seats = Number(booking?.reservedSeats || booking?.partySize || 1);
  const rb = {
    $inc: { capacityUsed: -seats },
    $pull: { activeBookingIds: String(booking.bookingId) },
    $set: { updatedAt: new Date() },
  };
  if (booking.bookingType === "SOLO") rb.$set.lockedSolo = false;

  try {
    await DriverStatus.updateOne({ driverId: new mongoose.Types.ObjectId(driverId) }, rb);
  } catch (e) {
    console.error(`⚠️ Seat release failed (${reason}):`, e?.message || e);
  }
}

async function cleanupExpiredReservations(targetDriverId = null) {
  // 🚫 Skip reservation cleanup entirely if disabled
  if (!RESERVATION_SECONDS) return;

  const now = new Date();
  const match = {
    status: "accepted",
    reservationExpiresAt: { $ne: null, $lt: now },
  };

  const expired = await Booking.find(match).lean();
  for (const b of expired) {
    const updated = await Booking.findOneAndUpdate(
      { bookingId: b.bookingId, status: "accepted" },
      {
        $set: {
          status: "pending",
          driverId: null,
          reservationExpiresAt: null,
          driverLock: false,
        },
      },
      { new: true }
    ).lean();

    if (updated && b.driverId) {
      if (!targetDriverId || String(targetDriverId) === String(b.driverId)) {
        await releaseSeats({ driverId: b.driverId, booking: b, reason: "expire" });
      }
    }
  }
}


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
      pickupPlace,
      destinationPlace,
      bookingType = "CLASSIC",
      partySize,
      bookedFor,      // NEW
      riderName,      // NEW
      riderPhone,     // NEW
    } = req.body;

    const paymentStatus =
      String(paymentMethod || "").toLowerCase() === "gcash" ? "awaiting" : "none";

    // Basic coordinate + passenger checks
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

    const bookedForBool =
      typeof bookedFor === "string"
        ? ["true", "1", "yes"].includes(bookedFor.toLowerCase())
        : Boolean(bookedFor);
    const riderNameStr = String(riderName || "").trim();
    const riderPhoneStr = String(riderPhone || "").trim();

    if (bookedForBool && !riderNameStr) {
      return res.status(400).json({ message: "riderName is required when bookedFor=true" });
    }

    const type = ["CLASSIC", "GROUP", "SOLO"].includes(String(bookingType).toUpperCase())
      ? String(bookingType).toUpperCase()
      : "CLASSIC";

    let size = Number(partySize);
    if (type === "SOLO") size = 1;
    else if (!Number.isFinite(size) || size < 1) size = 1;
    else if (type === "GROUP" && size > 5) size = 5;

    const isShareable = type !== "SOLO";
    const reservedSeats = size;

    let passengerName = "Passenger";
    try {
      const p = await Passenger.findById(passengerId).select("firstName middleName lastName");
      if (p) {
        passengerName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
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
      pickupPlace,
      destinationPlace,

      bookedFor: bookedForBool,  
      riderName: riderNameStr,    
      riderPhone: riderPhoneStr,  

      bookingType: type,
      partySize: size,
      isShareable,
      reservedSeats,
      driverLock: false,

      status: "pending",
      passengerName,
      paymentStatus,
    });

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

    await cleanupExpiredReservations(driverId || null);

    let ds = null;
    if (driverId) {
      ds = await DriverStatus.findOne({ driverId }).lean();
      if (!ds || !ds.isOnline) {
        return res.status(403).json({ message: "Driver is offline" });
      }
    }

    const center = { lat, lng };

    // Only pending bookings
    const pending = await Booking.find({ status: "pending" }).lean();

    const filtered = (pending || []).filter((b) => {
      if (!driverId || !ds) return true;
      return fitsCapacity(b, ds);
    });

    const out = filtered
      .map((b) => {
        const distM = haversineMeters(center, {
          lat: Number(b.pickupLat),
          lng: Number(b.pickupLng),
        });
        return {
          id: b.bookingId,
          pickup: { lat: b.pickupLat, lng: b.pickupLng },
          destination: { lat: b.destinationLat, lng: b.destinationLng },
          fare: b.fare,
          passengerPreview: {
            name: b.bookedFor ? (b.riderName || "Rider") : (b.passengerName || "Passenger"),
            bookedFor: !!b.bookedFor, // NEW indicator
          },
          distanceKm: distM / 1000,
          createdAt: b.createdAt,
          bookingType: b.bookingType,
          partySize: b.partySize,
          isShareable: b.isShareable,
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



// ---------- GET /driver-requests/:driverId ----------
router.get("/driver-requests/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    if (!driverId) {
      return res.status(400).json({ error: "driverId is required" });
    }

    // Lazy cleanup for this driver
    await cleanupExpiredReservations(driverId);

    const match =
      isObjectId(driverId)
        ? { driverId: new mongoose.Types.ObjectId(driverId) }
        : { driverId: driverId };

    const rows = await Booking.find({
      ...match,
      status: { $in: ["pending", "accepted"] },
    }).lean();

    const sanitized = (rows || []).map((b) => ({
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

      bookingType: b.bookingType,
      partySize: b.partySize,
      isShareable: b.isShareable,
      reservationExpiresAt: b.reservationExpiresAt || null,

      // NEW fields for driver UI
      bookedFor: !!b.bookedFor,
      riderName: b.riderName || "",
      riderPhone: b.riderPhone || "",
      pickupPlace: b.pickupPlace || null,
      destinationPlace: b.destinationPlace || null,
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

// ---------- POST /accept-booking ----------
router.post("/accept-booking", async (req, res) => {
  try {
    const { bookingId, driverId } = req.body;
    if (!bookingId || !driverId) {
      return res.status(400).json({ message: "bookingId and driverId are required" });
    }

    // Load booking (must be pending)
    const b = await Booking.findOne({ bookingId, status: "pending" }).lean();
    if (!b) {
      return res.status(409).json({ message: "Booking not found or already accepted" });
    }

    // Ensure DriverStatus exists & online
    const ds = await getDriverStatusOrInit(driverId);
    if (!ds || !ds.isOnline) {
      return res.status(403).json({ message: "Driver is offline" });
    }

    // Capacity/lock guard and atomic claim+reserve
    const result = await reserveSeatsAtomic({ driverId, booking: b });
    if (!result.ok) {
      const msg =
        result.reason === "capacity_or_lock"
          ? "Driver cannot accept (capacity/lock)"
          : "Booking already accepted by another driver";
      return res.status(409).json({ message: msg });
    }

    // Persist accepted status + timestamp (idempotent-safe)
    await Booking.updateOne(
      { bookingId },
      {
        $set: {
          status: "accepted",
          driverId,
          acceptedAt: new Date(),
          canceledAt: null,
        },
      }
    );

    // 🔵 If this is a GCash ride, snapshot driver's payment info into the booking
    try {
      const method = String(result.booking?.paymentMethod || "").toLowerCase();
      if (method === "gcash") {
        const d = await Driver.findById(driverId).select("gcashNumber gcashQRUrl gcashQRPublicId");
        if (d) {
          await Booking.updateOne(
            { bookingId },
            {
              $set: {
                paymentStatus: "awaiting",
                driverPayment: {
                  number: d.gcashNumber || "",
                  qrUrl: d.gcashQRUrl || null,
                  qrPublicId: d.gcashQRPublicId || null,
                },
              },
            }
          );
        }
      }
    } catch (e) {
      console.warn("GCash snapshot failed:", e?.message || e);
    }

    // Return fresh booking
    const fresh = await Booking.findOne({ bookingId }).lean();
    return res.status(200).json({
      message: "Booking accepted",
      booking: fresh || result.booking,
    });
  } catch (e) {
    console.error("❌ accept-booking error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});


// ---------- POST /cancel-booking ----------
router.post("/cancel-booking", async (req, res) => {
  try {
    const { bookingId, cancelledBy } = req.body; // "driver" | "passenger" | "system"
    if (!bookingId) {
      return res.status(400).json({ message: "bookingId required" });
    }

    const b = await Booking.findOne({ bookingId }).lean();
    if (!b) return res.status(404).json({ message: "Booking not found" });

    // If it was accepted and has a driver, release seats
    if (b.status === "accepted" && b.driverId) {
      await releaseSeats({ driverId: b.driverId, booking: b, reason: "cancel" });
    }

    const updated = await Booking.findOneAndUpdate(
      { bookingId },
      {
        $set: {
          status: "canceled",
          cancelledBy: cancelledBy || "passenger",
          canceledAt: new Date(),
          reservationExpiresAt: null,
          driverLock: false,
        },
      },
      { new: true }
    ).lean();

    return res.status(200).json({ message: "Booking cancelled", booking: updated });
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

    const b = await Booking.findOne({ bookingId }).lean();
    if (!b) return res.status(404).json({ message: "Booking not found" });

    // If accepted/enroute and has a driver, release seats
    if ((b.status === "accepted" || b.status === "enroute") && b.driverId) {
      await releaseSeats({ driverId: b.driverId, booking: b, reason: "complete" });
    }

    const updated = await Booking.findOneAndUpdate(
      { bookingId },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          reservationExpiresAt: null,
          driverLock: false,
        },
      },
      { new: true }
    );

    try {
      const niceType = ((t) => {
        const up = String(t || "CLASSIC").toUpperCase();
        if (up === "GROUP") return "Group";
        if (up === "SOLO") return "Solo";
        return "Classic";
      })(updated.bookingType);

      const seats = Number(updated.partySize || 1);
      const baseFare = Number(updated.fare || 0);
      const totalFare =
        niceType === "Group" ? baseFare * (Number.isFinite(seats) ? seats : 1) : baseFare;

      await RideHistory.create({
        bookingId: updated.bookingId,
        passengerId: updated.passengerId,
        driverId: updated.driverId,

        pickupLat: updated.pickupLat,
        pickupLng: updated.pickupLng,
        destinationLat: updated.destinationLat,
        destinationLng: updated.destinationLng,

        pickupPlace: updated.pickupPlace || null,
        destinationPlace: updated.destinationPlace || null,

        fare: baseFare,
        totalFare,
        paymentMethod: updated.paymentMethod,
        notes: updated.notes,

        bookingType: niceType,
        groupCount: Number.isFinite(seats) ? seats : 1,

        // 🔵 NEW: persist “book for someone else” audit
        bookedFor: !!updated.bookedFor,
        riderName: updated.riderName || null,
        riderPhone: updated.riderPhone || null,

        completedAt: new Date(),
      });
    } catch (e) {
      console.error("❌ Error saving ride history:", e);
    }

    return res.status(200).json({
      message: "Booking marked as completed and history saved!",
      booking: { ...(updated.toObject?.() ?? updated), id: updated.bookingId },
    });
  } catch (e) {
    console.error("❌ complete-booking error:", e);
    return res.status(500).json({ message: "Server error", details: e.message });
  }
});



// ---------- (Optional) GET /bookings — debug only ----------
router.get("/bookings", async (_req, res) => {
  try {
    const rows = await Booking.find({}).sort({ createdAt: -1 }).lean();
    return res.status(200).json(
      rows.map((b) => ({
        ...b,
        id: b.bookingId,
      }))
    );
  } catch (e) {
    console.error("❌ list bookings error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/booking/:bookingId/payment-info", async (req, res) => {
  try {
    const b = await Booking.findOne({ bookingId: req.params.bookingId })
      .select("bookingId driverId paymentMethod paymentStatus driverPayment status")
      .lean();
    if (!b) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, ...b });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/booking/:bookingId/payment-status", async (req, res) => {
  try {
    const { status } = req.body; // "paid" | "failed"
    if (!["paid", "failed"].includes(String(status))) {
      return res.status(400).json({ ok: false, error: "Invalid status" });
    }

    const b = await Booking.findOneAndUpdate(
      { bookingId: req.params.bookingId },
      { $set: { paymentStatus: status } },
      { new: true }
    ).lean();

    if (!b) return res.status(404).json({ ok: false, error: "Not found" });
    return res.json({ ok: true, paymentStatus: b.paymentStatus });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});


module.exports = router;
