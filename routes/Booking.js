// routes/Booking.js (Mongo-only)
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const DriverStatus = require("../models/DriverStatus");
const Passenger = require("../models/Passenger");
const RideHistory = require("../models/RideHistory");
const Booking = require("../models/Bookings");
const Driver = require("../models/Drivers");
const Toda = require("../models/Toda");


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
// --- geometry helpers for AI matcher ---

function distanceKm(a, b) {
  return haversineMeters(a, b) / 1000;
}

// distance from point P to segment AB (all in {lat,lng})
function pointToSegmentMeters(p, a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;

  const lat1 = toRad(a.lat);
  const lng1 = toRad(a.lng);
  const lat2 = toRad(b.lat);
  const lng2 = toRad(b.lng);
  const latP = toRad(p.lat);
  const lngP = toRad(p.lng);

  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;

  // if segment is tiny, just return distance to A
  const segLen2 = dLat * dLat + dLng * dLng;
  if (segLen2 === 0) {
    return haversineMeters(p, a);
  }

  // projection factor t on AB (0..1)
  let t = ((latP - lat1) * dLat + (lngP - lng1) * dLng) / segLen2;
  t = Math.max(0, Math.min(1, t));

  const proj = {
    lat: lat1 + t * dLat,
    lng: lng1 + t * dLng,
  };
  // convert back to degrees for haversineMeters
  proj.lat = (proj.lat * 180) / Math.PI;
  proj.lng = (proj.lng * 180) / Math.PI;

  return haversineMeters(p, proj);
}

// min distance from point to polyline route
function routeDistanceMeters(routePoints, p) {
  if (!Array.isArray(routePoints) || routePoints.length < 2) {
    return Infinity;
  }
  let best = Infinity;
  for (let i = 0; i < routePoints.length - 1; i++) {
    const a = routePoints[i];
    const b = routePoints[i + 1];
    const d = pointToSegmentMeters(p, a, b);
    if (d < best) best = d;
  }
  return best;
}

// sum of segment distances in a polyline
function polylineLengthKm(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += distanceKm(points[i], points[i + 1]);
  }
  return total;
}

// --- heading helpers for AI matching ---
function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  let θ = toDeg(Math.atan2(y, x));
  if (!Number.isFinite(θ)) return 0;
  // normalize 0–360
  return (θ + 360) % 360;
}

function angleDiffDeg(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d; // 0–180
}


function isDestinationCompatible(mainDest, candDest, mainHeadingDeg) {
  const A = {
    lat: Number(mainDest.lat),
    lng: Number(mainDest.lng),
  };
  const B = {
    lat: Number(candDest.lat),
    lng: Number(candDest.lng),
  };

  if (
    !Number.isFinite(A.lat) || !Number.isFinite(A.lng) ||
    !Number.isFinite(B.lat) || !Number.isFinite(B.lng)
  ) {
    // if anything is missing, don't reject based on this
    return true;
  }

  // 1) How far is B from A?
  const distABm = haversine(A.lat, A.lng, B.lat, B.lng); // you already have haversine()
  const distABkm = distABm / 1000;

  // 2) Direction from driver’s main route to B
  const headingAB = bearingDeg(A.lat, A.lng, B.lat, B.lng);
  const diffAB = angleDiffDeg(mainHeadingDeg, headingAB);

  // Rules:
  // - if B is very close to A (say ≤ 0.3 km), small turn-back is OK
  if (distABkm <= 0.3) return true;

  // - otherwise, its direction from A should still be roughly forward
  //   (not going back the opposite way)
  return diffAB <= 90; // <= 90° = still generally “ahead or side”, >90 = going back
}



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


// 🔹 Find which TODA zone this pickup belongs to (if any)
async function findPickupTodaId(pickupLat, pickupLng) {
  // guard: coordinates
  if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) return null;

  // get active TODAs
  const todas = await Toda.find({ isActive: true }).lean();
  if (!todas.length) return null;

  let bestId = null;
  let bestDist = Infinity;

  for (const t of todas) {
    if (typeof t.latitude !== "number" || typeof t.longitude !== "number") continue;

    const distM = haversine(
      pickupLat,
      pickupLng,
      t.latitude,
      t.longitude
    );

    // If you later add t.radiusMeters, use that; for now fallback to 100m
    const radiusM =
      typeof t.radiusMeters === "number" && Number.isFinite(t.radiusMeters)
        ? t.radiusMeters
        : 100;

    if (distM <= radiusM && distM < bestDist) {
      bestDist = distM;
      bestId = t._id;
    }
  }

  return bestId; // ObjectId or null
}


// 🔹 Try to extract route polylines from a TODA doc
function extractTodaRoutes(t) {
  const routes = [];

  // Common pattern: an array of routeVariants, each with points/coords/path
  if (Array.isArray(t.routeVariants)) {
    for (const rv of t.routeVariants) {
      const raw =
        (Array.isArray(rv.points) && rv.points) ||
        (Array.isArray(rv.coords) && rv.coords) ||
        (Array.isArray(rv.path) && rv.path) ||
        [];
      const pts = raw
        .map((p) => ({
          lat: Number(p.lat ?? p.latitude),
          lng: Number(p.lng ?? p.longitude),
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

      if (pts.length >= 2) routes.push(pts);
    }
  }

  // Fallback: flat array of points directly on the TODA
  if (Array.isArray(t.routePoints)) {
    const pts = t.routePoints
      .map((p) => ({
        lat: Number(p.lat ?? p.latitude),
        lng: Number(p.lng ?? p.longitude),
      }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (pts.length >= 2) routes.push(pts);
  }

  return routes;
}

// 🔹 Check if a destination lies within a corridor around TODA routes
function isDestinationServedByToda(toda, destLat, destLng) {
  if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return true;

  const routes = extractTodaRoutes(toda);
  if (!routes.length) {
    // No geometry configured → don’t reject anything for this TODA
    return true;
  }

  const p = { lat: destLat, lng: destLng };
  const MAX_CORRIDOR_M =
    typeof toda.routeCorridorMeters === "number" && toda.routeCorridorMeters > 0
      ? toda.routeCorridorMeters
      : 500; // 500m default

  for (const poly of routes) {
    const d = routeDistanceMeters(poly, p); // you already defined routeDistanceMeters above
    if (d <= MAX_CORRIDOR_M) return true;
  }
  return false;
}



// 🔹 Match trip to TODA line based on destination (and a bit of pickup)
async function matchTripToToda(pickupLat, pickupLng, destinationLat, destinationLng) {
  if (
    !Number.isFinite(pickupLat) ||
    !Number.isFinite(pickupLng) ||
    !Number.isFinite(destinationLat) ||
    !Number.isFinite(destinationLng)
  ) {
    return { destinationTodaId: null, candidateTodaIds: [] };
  }

  const todas = await Toda.find({ isActive: true }).lean();
  if (!todas.length) {
    return { destinationTodaId: null, candidateTodaIds: [] };
  }

  const candidates = [];

  for (const t of todas) {
    let bestDestDistM = Infinity;

    const tLat = Number(t.latitude);
    const tLng = Number(t.longitude);

    // 🔸 1) distance from pickup to TODA terminal (avoid matching super far trips)
    const pickupToTerminalM = Number.isFinite(tLat) && Number.isFinite(tLng)
      ? haversine(pickupLat, pickupLng, tLat, tLng)
      : Infinity;

    // soft guard: > 8km from terminal? we still allow but mark it “weak”
    const pickupOK = pickupToTerminalM <= 8000 || !Number.isFinite(pickupToTerminalM);

    // 🔸 2) check FINAL DESTINATIONS
    if (Array.isArray(t.finalDestinations)) {
      for (const fd of t.finalDestinations) {
        const fdLat = Number(fd.latitude);
        const fdLng = Number(fd.longitude);
        if (!Number.isFinite(fdLat) || !Number.isFinite(fdLng)) continue;

        const d = haversine(destinationLat, destinationLng, fdLat, fdLng);
        if (d < bestDestDistM) bestDestDistM = d;
      }
    }

    // 🔸 3) check SERVED DESTINATIONS
    if (Array.isArray(t.servedDestinations)) {
      for (const sd of t.servedDestinations) {
        const sdLat = Number(sd.latitude);
        const sdLng = Number(sd.longitude);
        if (!Number.isFinite(sdLat) || !Number.isFinite(sdLng)) continue;

        const d = haversine(destinationLat, destinationLng, sdLat, sdLng);
        if (d < bestDestDistM) bestDestDistM = d;
      }
    }

    // If we never got a good distance, skip
    if (!Number.isFinite(bestDestDistM)) continue;

    // 🔸 4) threshold for “good enough” match
    //    - destination within 1.5km of any final/served stop
    const DEST_THRESHOLD_M = 1500;

    if (bestDestDistM <= DEST_THRESHOLD_M && pickupOK) {
      candidates.push({
        todaId: t._id,
        bestDestDistM,
        pickupToTerminalM,
      });
    }
  }

  if (!candidates.length) {
    return { destinationTodaId: null, candidateTodaIds: [] };
  }

  // 🔹 choose BEST by smallest destination distance (tie-breaker by closer terminal)
  candidates.sort((a, b) => {
    if (a.bestDestDistM !== b.bestDestDistM) {
      return a.bestDestDistM - b.bestDestDistM;
    }
    return a.pickupToTerminalM - b.pickupToTerminalM;
  });

  const destinationTodaId = candidates[0].todaId;
  const candidateTodaIds = candidates.map((c) => c.todaId);

  return { destinationTodaId, candidateTodaIds };
}


// 🔹 TODA-aware filter for /waiting-bookings
async function todaAwareFilterForDriver(candidates, driverId) {
  if (!driverId || !isObjectId(driverId)) return candidates;

  // Who is the driver asking?
  const ds = await DriverStatus.findOne({
    driverId: new mongoose.Types.ObjectId(driverId),
  })
    .select("currentTodaId inTodaZone isOnline updatedAt")
    .lean();

  if (!ds) return candidates;

  const driverTodaId = ds.currentTodaId ? String(ds.currentTodaId) : null;

  // --- CASE A: Driver belongs to a TODA (TODA driver) ---
  if (driverTodaId) {
    // TODA driver:
    //  - can see bookings in *their* TODA that are NOT rejected
    //  - can see bookings outside any TODA
    //  - cannot see bookings in other TODAs
    return candidates.filter((b) => {
      const bt = b.pickupTodaId ? String(b.pickupTodaId) : null;
      const rejected = !!b.pickupTodaRejected;

      // Booking belongs to a different TODA → never show
      if (bt && bt !== driverTodaId) return false;

      // Booking is in THIS TODA but TODA routes do not serve destination
      if (bt === driverTodaId && rejected) return false;

      // Outside any TODA or accepted inside this TODA
      return true;
    });
  }

  // --- CASE B: Roaming driver (no currentTodaId) ---
  // Roaming should:
  //  - see outside-TODA bookings
  //  - see TODA bookings that were rejected by that TODA (pickupTodaRejected = true)
  //  - only see normal TODA bookings if that TODA has no active drivers

  // 1) Collect all TODA ids from these bookings
  const todaIds = [
    ...new Set(
      candidates
        .map((b) => (b.pickupTodaId ? String(b.pickupTodaId) : null))
        .filter(Boolean)
    ),
  ];

  if (!todaIds.length) {
    // No TODA bookings here anyway
    return candidates;
  }

  // 2) Find online TODA drivers for these TODAs
  const dsList = await DriverStatus.find({
    currentTodaId: { $in: todaIds.map((id) => new mongoose.Types.ObjectId(id)) },
    isOnline: true,
  })
    .select("currentTodaId updatedAt")
    .lean();

  const now = Date.now();
  const ACTIVE_MS = 60_000; // same window as /driver-status

  const activeTodaSet = new Set(
    dsList
      .filter((s) => now - new Date(s.updatedAt).getTime() < ACTIVE_MS)
      .map((s) => String(s.currentTodaId))
  );

  return candidates.filter((b) => {
    const bt = b.pickupTodaId ? String(b.pickupTodaId) : null;
    const rejected = !!b.pickupTodaRejected;

    // Outside TODA → always allowed
    if (!bt) return true;

    // Inside TODA but TODA rejected this job → roaming drivers can always see it
    if (rejected) return true;

    // Normal TODA booking: only show if no active TODA drivers
    if (!activeTodaSet.has(bt)) return true;

    // TODA drivers are active → roaming driver cannot see this booking
    return false;
  });
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

        // 🔹 Detect which TODA zone this pickup belongs to (if any)
    const pickupTodaId = await findPickupTodaId(
      Number(pickupLat),
      Number(pickupLng)
    );

        // 🔹 Match trip to TODA line based on destination & route
    const { destinationTodaId, candidateTodaIds } = await matchTripToToda(
      Number(pickupLat),
      Number(pickupLng),
      Number(destinationLat),
      Number(destinationLng)
    );

    // 🔹 Decide if TODA actually serves this destination
    let pickupTodaRejected = false;
    if (pickupTodaId) {
      try {
        const toda = await Toda.findById(pickupTodaId).lean();
        if (toda) {
          const destLatNum = Number(destinationLat);
          const destLngNum = Number(destinationLng);
          const served = isDestinationServedByToda(toda, destLatNum, destLngNum);
          pickupTodaRejected = !served; // true when inside zone but route doesn't match
        }
      } catch (e) {
        console.warn("⚠️ TODA route check failed:", e?.message || e);
      }
    }



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

      // TODA info
      pickupTodaId: pickupTodaId || null,
      pickupTodaRejected,  
      destinationTodaId: destinationTodaId || null,
      candidateTodaIds: candidateTodaIds || [],

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
// ===============================
//   /api/waiting-bookings (AI v1 + TODA restriction)
// ===============================
router.get("/waiting-bookings", async (req, res) => {
  try {
    const { lat, lng, radiusKm = 5, limit = 10, driverId, ai } = req.query;

    const center = {
      lat: Number(lat),
      lng: Number(lng),
    };
    const rad = Number(radiusKm);
    const lim = Number(limit);
    const aiMode = ai === "1";

    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
      return res.status(400).json([]);
    }

    // 🔹 Simple helper: distance in km
    const distKm = (a, b) => {
      const R = 6371;
      const dLat = ((b.lat - a.lat) * Math.PI) / 180;
      const dLng = ((b.lng - a.lng) * Math.PI) / 180;
      const lat1 = (a.lat * Math.PI) / 180;
      const lat2 = (b.lat * Math.PI) / 180;

      const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(s));
    };

    // 🔹 Haversine in meters
    function haversine(lat1, lng1, lat2, lng2) {
      const R = 6371000;
      const toRad = (d) => (d * Math.PI) / 180;

      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);

      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLng / 2) ** 2;

      return 2 * R * Math.asin(Math.sqrt(a));
    }

    // 🔹 Bearing
    function bearingDeg(lat1, lng1, lat2, lng2) {
      const toRad = (d) => (d * Math.PI) / 180;
      const toDeg = (d) => (d * 180) / Math.PI;
      const dLng = toRad(lng2 - lng1);

      const y = Math.sin(dLng) * Math.cos(toRad(lat2));
      const x =
        Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
        Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);

      return (toDeg(Math.atan2(y, x)) + 360) % 360;
    }

    // 🔹 Angle difference (0–180)
    function angleDiffDeg(a, b) {
      let d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    }

    // 🔥 destination compatibility (AI stuff – unchanged)
    function isDestinationCompatible(mainDest, candDest, mainHeadingDeg) {
      const A = { lat: Number(mainDest.lat), lng: Number(mainDest.lng) };
      const B = { lat: Number(candDest.lat), lng: Number(candDest.lng) };

      if (
        !Number.isFinite(A.lat) ||
        !Number.isFinite(A.lng) ||
        !Number.isFinite(B.lat) ||
        !Number.isFinite(B.lng)
      )
        return true;

      const distABm = haversine(A.lat, A.lng, B.lat, B.lng);
      const distABkm = distABm / 1000;

      const headingAB = bearingDeg(A.lat, A.lng, B.lat, B.lng);
      const diffAB = angleDiffDeg(mainHeadingDeg, headingAB);

      if (distABkm <= 0.3) return true;
      return diffAB <= 90;
    }

    // 🔹 Fetch waiting bookings (all pending)
    const nearby = await Booking.find({
      status: "pending",
      pickupLat: { $exists: true },
      pickupLng: { $exists: true },
    }).lean();

    // 🔹 Optional: load active main destination for AI mode
    let mainHeadingDeg = null;
    let activeMainDestLat = null;
    let activeMainDestLng = null;

    if (aiMode && driverId) {
      const match = { driverId: String(driverId), status: "accepted" };

      const active = await Booking.findOne(match)
        .sort({ createdAt: -1 })
        .lean();

      if (active) {
        activeMainDestLat = Number(active.destinationLat);
        activeMainDestLng = Number(active.destinationLng);

        if (
          Number.isFinite(activeMainDestLat) &&
          Number.isFinite(activeMainDestLng)
        ) {
          mainHeadingDeg = bearingDeg(
            center.lat,
            center.lng,
            activeMainDestLat,
            activeMainDestLng
          );
        }
      }
    }

    // 🔹 Base filter: distance + attach TODA flags from Booking
    const filteredBase = nearby
      .map((b) => {
        const pickup = { lat: Number(b.pickupLat), lng: Number(b.pickupLng) };
        b._distKm = distKm(center, pickup);

        // Use stored TODA info from Booking
        b.pickupTodaId = b.pickupTodaId ? String(b.pickupTodaId) : null;
        b.pickupTodaRejected = !!b.pickupTodaRejected;

        return b;
      })
      // 1) within radius
      .filter((b) => b._distKm <= rad);

    let filtered = filteredBase;

    // 2) TODA restriction (TODA vs Roaming, with rejection rules)
    if (driverId) {
      filtered = await todaAwareFilterForDriver(filtered, driverId);
    }

    // 3) AI direction filter (unchanged)
    filtered = filtered.filter((b) => {
      if (!aiMode || mainHeadingDeg == null) return true;

      const dLat = Number(b.destinationLat);
      const dLng = Number(b.destinationLng);

      if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return true;

      const candHeading = bearingDeg(center.lat, center.lng, dLat, dLng);
      const diff = angleDiffDeg(mainHeadingDeg, candHeading);

      // ❌ Opposite direction drop-off
      if (diff > 120) return false;

      // ❌ Check AFTER-drop-off compatibility
      if (activeMainDestLat != null && activeMainDestLng != null) {
        const ok = isDestinationCompatible(
          { lat: activeMainDestLat, lng: activeMainDestLng },
          { lat: dLat, lng: dLng },
          mainHeadingDeg
        );
        if (!ok) return false;
      }

      return true;
    });

    // 4) sort + limit
    filtered = filtered
      .sort((a, b) => a._distKm - b._distKm)
      .slice(0, lim)
      // 5) shape output for driver app
      .map((b) => {
        const id = b.bookingId || String(b._id);

        return {
          id,
          bookingId: id,
          fare: b.fare,
          pickup: { lat: b.pickupLat, lng: b.pickupLng },
          destination: { lat: b.destinationLat, lng: b.destinationLng },
          passengerPreview: {
            name: b.passengerName,
            bookedFor: b.bookedFor || false,
          },
          bookingType: b.bookingType,
          partySize: b.partySize || 1,
        };
      });

    return res.json(filtered);
  } catch (err) {
    console.error("❌ waiting-bookings error:", err);
    res.status(500).json([]);
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
