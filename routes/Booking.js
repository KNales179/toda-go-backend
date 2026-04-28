// Booking.js
const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const requireUserAuth = require("../middleware/requireUserAuth");
const requireAdminAuth = require("../middleware/requireAdminAuth");
const mongoose = require("mongoose");
const DriverStatus = require("../models/DriverStatus");
const Passenger = require("../models/Passenger");
const RideHistory = require("../models/RideHistory");
const Booking = require("../models/Bookings");
const FareConfig = require("../models/FareConfig");
const Driver = require("../models/Drivers");
const Toda = require("../models/Toda");
const Task = require("../models/Task");
const DEBUG_WAITING = true; 


async function sendPush(to, title, body, extra = {}) {
  if (!to) return;

  try {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        to,
        sound: "default",
        title,
        body,
        data: extra,
      }),
    });

    const json = await resp.json().catch(() => null);
  } catch (err) {
    console.error("❌ Push send failed:", err);
  }
}


async function computeEligibleTasks(driverId) {
  const open = await Task.find({
    driverId: String(driverId),
    status: { $in: ["PENDING", "ACTIVE"] },
  }).lean();

  if (!open.length) return [];

  const depIds = open
    .map((t) => t.dependsOnTaskId)
    .filter(Boolean)
    .map((id) => String(id));

  let completedDeps = new Set();
  if (depIds.length) {
    const deps = await Task.find({
      _id: { $in: depIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("_id status")
      .lean();

    completedDeps = new Set(
      deps.filter((d) => d.status === "COMPLETED").map((d) => String(d._id))
    );
  }

  return open.filter((t) => {
    if (!t.dependsOnTaskId) return true;
    return completedDeps.has(String(t.dependsOnTaskId));
  });
}

async function enforceSingleActiveAndPickNearest(driverId, curLat, curLng) {
  const cur = { lat: Number(curLat), lng: Number(curLng) };
  const ok = Number.isFinite(cur.lat) && Number.isFinite(cur.lng);

  const eligible = await computeEligibleTasks(driverId);

  let chosen = null;
  let best = Infinity;

  if (ok) {
    for (const t of eligible) {
      const d = haversineMeters(cur, { lat: Number(t.lat), lng: Number(t.lng) });
      if (d < best) {
        best = d;
        chosen = t;
      }
    }
  } else {
    // if no driver loc, pick oldest eligible
    chosen = eligible.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))[0] || null;
  }

  await Task.updateMany(
    { driverId: String(driverId), status: "ACTIVE" },
    { $set: { status: "PENDING" } }
  );

  if (chosen) {
    await Task.updateOne({ _id: chosen._id }, { $set: { status: "ACTIVE" } });
  }

  return {
    chosenTaskId: chosen ? String(chosen._id) : null,
    chosenDistanceMeters: chosen && ok ? Math.round(best) : null,
  };
}

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
        progressStatus: "to_pickup",
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
        : 300;

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
  if (Array.isArray(t.finalDestinations)) {
    for (const fd of t.finalDestinations) {
      const main = fd && fd.mainRoute;
      if (!main || !Array.isArray(main.coords)) continue;

      const pts = main.coords
        .map(([lng, lat]) => ({
          lat: Number(lat),
          lng: Number(lng),
        }))
        .filter(
          (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
        );

      if (pts.length >= 2) {
        routes.push(pts);
      }
    }
  }

  return routes;
}


const PICKUP_ROUTE_RADIUS_M = 300;
const DEST_ROUTE_RADIUS_M   = 250;
const DEST_STOP_EXTRA_M     = 200;
const INTODA_RADIUS_M       = 100;
const NEARTODA_RADIUS_M     = 300;

async function classifyTodaForTrip(
  pickupLat,
  pickupLng,
  destinationLat,
  destinationLng,
  chosenRoute
) {
  const pickup = { lat: pickupLat, lng: pickupLng };
  const dest = { lat: destinationLat, lng: destinationLng };

  const todas = await Toda.find({ isActive: true }).lean();
  if (!todas.length) {
    return {
      serviceTodaId: null,
      candidateTodaIds: [],
      pickupTodaRejected: true,
      passengerZoneTag: "FAR",
    };
  }

  const candidates = [];

  for (const t of todas) {
    const routes = extractTodaRoutes(t);
    if (!routes.length) {
      continue;
    }

    const tLat = Number(t.latitude);
    const tLng = Number(t.longitude);
    const terminalDistM = (Number.isFinite(tLat) && Number.isFinite(tLng))
      ? haversine(pickup.lat, pickup.lng, tLat, tLng)
      : Infinity;

    // 1) pickup near route
    let pickupRouteDistM = Infinity;
    for (const poly of routes) {
      pickupRouteDistM = Math.min(
        pickupRouteDistM,
        routeDistanceMeters(poly, pickup)
      );
    }
    if (pickupRouteDistM > PICKUP_ROUTE_RADIUS_M) continue;

    // 2) destination near route
    let destRouteDistM = Infinity;
    for (const poly of routes) {
      destRouteDistM = Math.min(
        destRouteDistM,
        routeDistanceMeters(poly, dest)
      );
    }

    // 3) find nearest stop (final or served) + distance
    let destStopDistM = Infinity;
    let bestStop = null;

    const allRoutes = routes;
    const mainRoute = allRoutes[0]; // assume first is official line

    const checkStops = (arr) => {
      if (!Array.isArray(arr)) return;
      for (const s of arr) {
        const sLat = Number(s.latitude);
        const sLng = Number(s.longitude);
        if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;

        const d = haversine(dest.lat, dest.lng, sLat, sLng);
        if (d < destStopDistM) {
          destStopDistM = d;
          bestStop = { lat: sLat, lng: sLng };
        }
      }
    };

    checkStops(t.finalDestinations);
    checkStops(t.servedDestinations);

    const nearRoute = destRouteDistM <= DEST_ROUTE_RADIUS_M;

    // 4) destination near stop BUT must be slightly "forward" along route, not backwards
    let nearStop = false;

    if (Number.isFinite(destStopDistM)) {
      if (!Array.isArray(mainRoute) || mainRoute.length < 2) {
        // no usable route geometry → simple radial rule
        nearStop = destStopDistM <= DEST_STOP_EXTRA_M;
      } else if (destStopDistM <= 50) {
        // very close to stop, direction doesn’t really matter
        nearStop = true;
      } else if (destStopDistM <= DEST_STOP_EXTRA_M && bestStop) {
        // use forward-direction rule along route
        // find closest point on mainRoute to the stop
        let bestIdx = 0;
        let bestIdxDist = Infinity;
        for (let i = 0; i < mainRoute.length; i++) {
          const rp = mainRoute[i];
          const d = haversine(bestStop.lat, bestStop.lng, rp.lat, rp.lng);
          if (d < bestIdxDist) {
            bestIdxDist = d;
            bestIdx = i;
          }
        }

        const prev = mainRoute[Math.max(bestIdx - 1, 0)];
        const next = mainRoute[Math.min(bestIdx + 1, mainRoute.length - 1)];

        let routeHeading = null;
        if (
          prev &&
          next &&
          Number.isFinite(prev.lat) &&
          Number.isFinite(prev.lng) &&
          Number.isFinite(next.lat) &&
          Number.isFinite(next.lng)
        ) {
          routeHeading = bearingDeg(prev.lat, prev.lng, next.lat, next.lng);
        }

        if (routeHeading != null) {
          const destHeading = bearingDeg(
            bestStop.lat,
            bestStop.lng,
            dest.lat,
            dest.lng
          );
          const diff = angleDiffDeg(routeHeading, destHeading);

          // Forward-ish (≤ 90°) within DEST_STOP_EXTRA_M
          if (diff <= 90) {
            nearStop = true;
          }
        }
      }
    }

    // 5) route compatibility (still logged, but not a hard blocker here)
    const routeOk = isRouteCompatibleWithToda(t, chosenRoute);

    // 6) TODA matches if destination is along/near the line OR near a forward stop
    const tripServed = nearRoute || nearStop;

    if (!tripServed) continue;

    // 👉 store terminal distance so we can later choose "closest TODA"
    candidates.push({
      toda: t,
      terminalDistM,
      pickupRouteDistM,
      destRouteDistM,
    });
  }

  if (!candidates.length) {
    return {
      serviceTodaId: null,
      candidateTodaIds: [],
      pickupTodaRejected: true,
      passengerZoneTag: "FAR",
    };
  }

  // 👉 primary key = distance to TODA terminal (closest TODA wins)
  candidates.sort((a, b) =>
    a.terminalDistM - b.terminalDistM ||
    a.destRouteDistM - b.destRouteDistM ||
    a.pickupRouteDistM - b.pickupRouteDistM
  );

  const best = candidates[0];
  const mainToda = best.toda;

  // zone classification using terminal distance
  const centerDistM = best.terminalDistM;

  let passengerZoneTag = "FAR";
  let pickupTodaRejected = true;

  if (centerDistM <= INTODA_RADIUS_M) {
    passengerZoneTag = "INTODA";
    pickupTodaRejected = false;
  } else if (centerDistM <= NEARTODA_RADIUS_M) {
    passengerZoneTag = "NEARTODA";
    pickupTodaRejected = false;
  }

  return {
    serviceTodaId: mainToda._id,
    candidateTodaIds: candidates.map((c) => c.toda._id),
    pickupTodaRejected,
    passengerZoneTag,
  };
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

function isRouteCompatibleWithToda(toda, chosenRoute) {
  if (!chosenRoute || !Array.isArray(chosenRoute.coords) || !chosenRoute.coords.length) {
    // no route info → don't block based on route
    return true;
  }

  const routes = extractTodaRoutes(toda);
  if (!routes.length) return true; // TODA has no geometry yet

  const corridor =
    typeof toda.routeCorridorMeters === "number" && toda.routeCorridorMeters > 0
      ? toda.routeCorridorMeters
      : 250; // tighter than old 500m

  // chosenRoute.coords is [ [lng,lat], ... ]
  const pts = chosenRoute.coords
    .map(([lng, lat]) => ({
      lat: Number(lat),
      lng: Number(lng),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  if (pts.length < 2) return true;

  // Sample at most ~30 points along the route
  const step = Math.max(1, Math.floor(pts.length / 30));
  let total = 0;
  let bad = 0;

  for (let i = 0; i < pts.length; i += step) {
    const p = pts[i];
    let best = Infinity;

    for (const poly of routes) {
      const d = routeDistanceMeters(poly, p);
      if (d < best) best = d;
    }

    total++;
    if (best > corridor) bad++;
  }

  // If more than 30% of sampled points are outside corridor → not compatible
  return bad <= total * 0.3;
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
    const DEST_THRESHOLD_M = 200;

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

  const main = candidates[0];
  const mainToda = main.toda;
  const destinationTodaId = candidates[0].todaId;
  const candidateTodaIds = candidates.map((c) => c.todaId);

  return { destinationTodaId, candidateTodaIds };
}

// 🔹 TODA-aware filter for /waiting-bookings with driver/passenger classification
async function todaAwareFilterForDriver(candidates, driverId) {
  // 1) Load DriverStatus (zone context)
  const ds = await DriverStatus.findOne({
    driverId: new mongoose.Types.ObjectId(driverId),
  })
    .select("currentTodaId inTodaZone isOnline updatedAt")
    .lean();

  const zoneTodaId = ds?.currentTodaId ? String(ds.currentTodaId) : null; // where the driver is
  const inTodaZone = !!ds?.inTodaZone;

  // 2) Load Driver (membership TODA name)
  const driver = await Driver.findById(driverId).select("todaName").lean();
  const todaName = driver?.todaName || null;

  let memberTodaId = null;
  if (todaName) {
    const memberToda = await Toda.findOne({ name: todaName })
      .select("_id name")
      .lean();
    if (memberToda) {
      memberTodaId = String(memberToda._id); // which TODA they belong to
    }
  }

  // 3) Classify driver: TODA / NON_TODA / NORMAL
  let driverType = "NORMAL";

  if (inTodaZone && zoneTodaId) {
    if (memberTodaId && zoneTodaId === memberTodaId) {
      driverType = "TODA";      // inside zone + member of that TODA
    } else {
      driverType = "NON_TODA";  // inside some TODA but not a member
    }
  }
  // ---------- CASE 1: TODA DRIVER ----------
  if (driverType === "TODA" && memberTodaId) {
    const out = candidates.filter((b) => {
      const destTodaId = b.destinationTodaId ? String(b.destinationTodaId) : null;
      const pickupTodaId = b.pickupTodaId ? String(b.pickupTodaId) : null;
      const rejected = !!b.pickupTodaRejected;
      const zoneTag = (b.passengerZoneTag || "FAR").toUpperCase();

      const matchedToThisToda =
        (pickupTodaId && pickupTodaId === memberTodaId) ||
        (destTodaId && destTodaId === memberTodaId);

      const keep =
        matchedToThisToda &&
        !rejected &&
        (zoneTag === "INTODA" || zoneTag === "NEARTODA");

      return keep;
    });
    return out;
  }

  // ---------- CASE 2: NON-TODA or NORMAL DRIVER ----------
  const out = candidates.filter((b) => {
    const destTodaId = b.destinationTodaId ? String(b.destinationTodaId) : null;
    const rejected = !!b.pickupTodaRejected;
    const zoneTag = (b.passengerZoneTag || "FAR").toUpperCase();

    const noTodaMatch = !destTodaId;
    const isFar = zoneTag === "FAR";

    const keep = rejected || noTodaMatch || isFar;

    return keep;
  });

  return out;
}


// ---------- POST /book ----------
router.post("/book", requireUserAuth, async (req, res) => {
  try {
    const {
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      estimatedFare = 0,
      distanceKm,
      paymentMethod,
      notes,
      pickupPlace,
      destinationPlace,
      bookingType = "CLASSIC",
      partySize,
      bookedFor,
      riderName,
      riderPhone,
      chosenRoute,
    } = req.body;

    if (req.user.role !== "passenger") {
      return res.status(403).json({ message: "Passengers only" });
    }

    const passengerId = req.user.sub;

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

    // ------------------------------
    // Compute final authoritative fare on backend
    // ------------------------------
    let resolvedDistanceKm = Number(distanceKm);

    if (!Number.isFinite(resolvedDistanceKm) || resolvedDistanceKm <= 0) {
      const routeMeters = Number(chosenRoute?.distanceMeters);
      if (Number.isFinite(routeMeters) && routeMeters > 0) {
        resolvedDistanceKm = routeMeters / 1000;
      }
    }

    if (!Number.isFinite(resolvedDistanceKm) || resolvedDistanceKm <= 0) {
      return res.status(400).json({ message: "Valid distanceKm is required" });
    }

    const config = await FareConfig.getSingleton();
    const isSolo = type === "SOLO";
    const fareRules = isSolo ? config.special : config.regular;

    let computedFare = 0;

    if (isSolo && resolvedDistanceKm <= Number(fareRules.shortKm || 0)) {
      computedFare = Number(fareRules.shortFare || 0);
    } else {
      const extraKm = Math.max(0, resolvedDistanceKm - Number(fareRules.baseKm || 0));
      const additionalUnits = Math.ceil(extraKm);

      computedFare =
        Number(fareRules.baseFare || 0) +
        additionalUnits * Number(fareRules.addlPerKm || 0);
    }

    if (fareRules.chargeMode === "per_passenger") {
      computedFare *= size;
    }

    let discountApplied = 0;

    try {
      const passenger = await Passenger.findById(passengerId);

      if (
        config.discounts?.enabled &&
        passenger?.discount &&
        passenger?.discountVerification?.status === "approved"
      ) {
        function normalizeDiscountType(value) {
          const v = String(value || "").trim().toLowerCase();

          if (v === "senior citizen" || v === "senior") return "senior";
          if (v === "pwd") return "pwd";
          if (v === "student") return "student";

          return "";
        }
        const normalizedType = normalizeDiscountType(
          passenger.discountType || passenger.discountVerification?.type
        );
        const allowedTypes = Array.isArray(config.discounts?.appliesTo)
          ? config.discounts.appliesTo.map((x) => String(x).toLowerCase())
          : [];

        if (allowedTypes.includes(normalizedType)) {
          discountApplied = Number(config.discounts.percent || 0);
          computedFare = computedFare - (computedFare * discountApplied) / 100;
        }
      }
    } catch (err) {
      console.warn("Passenger discount lookup failed during booking:", err?.message || err);
    }

    computedFare = Math.round(computedFare);

    let passengerName = "Passenger";
    try {
      const p = await Passenger.findById(passengerId).select("firstName middleName lastName");
      if (p) {
        passengerName = [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
      }
    } catch {}

    // 🔹 New: classify trip vs TODA lines (route + destination + zone)
    const {
      serviceTodaId,
      candidateTodaIds,
      pickupTodaRejected,
      passengerZoneTag,
    } = await classifyTodaForTrip(
      Number(pickupLat),
      Number(pickupLng),
      Number(destinationLat),
      Number(destinationLng),
      chosenRoute || null
    );

    // For storage we treat the "service TODA" as both pickup/destination TODA when accepted
    const pickupTodaId = serviceTodaId || null;
    const destinationTodaId = serviceTodaId || null;




    const booking = await Booking.create({
      passengerId,
      pickupLat,
      pickupLng,
      destinationLat,
      destinationLng,
      fare: computedFare,
      estimatedFare: Number(estimatedFare) || 0,
      distanceKm: resolvedDistanceKm,
      fareBreakdown: {
        baseFare: Number(fareRules.baseFare || 0),
        addlPerKm: Number(fareRules.addlPerKm || 0),
        discountApplied,
        bookingType: type,
        chargeMode: fareRules.chargeMode || "",
        partySize: size,
        computedAt: new Date(),
      },
      paymentMethod,
      notes,
      pickupPlace,
      destinationPlace,

      // TODA info
      pickupTodaId: pickupTodaId || null,
      pickupTodaRejected,  
      destinationTodaId: destinationTodaId || null,
      candidateTodaIds: candidateTodaIds || [],
      passengerZoneTag,
      chosenRoute: chosenRoute || null,

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
router.get("/waiting-bookings", requireUserAuth, async (req, res) => {
  try {
    const { lat, lng, radiusKm = 5, limit = 10, ai } = req.query;

    if (req.user.role !== "driver") {
      return res.status(403).json({ message: "Drivers only" });
    }

    const driverId = req.user.sub;

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

    // 🔹 Haversine in meters (fixed dLng)
    function haversineLocal(lat1, lng1, lat2, lng2) {
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
    function bearingDegLocal(lat1, lng1, lat2, lng2) {
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
    function angleDiffDegLocal(a, b) {
      let d = Math.abs(a - b) % 360;
      return d > 180 ? 360 - d : d;
    }

    // 🔥 destination compatibility (AI stuff – uses local helpers)
    function isDestinationCompatibleLocal(mainDest, candDest, mainHeadingDeg) {
      const A = { lat: Number(mainDest.lat), lng: Number(mainDest.lng) };
      const B = { lat: Number(candDest.lat), lng: Number(candDest.lng) };

      if (
        !Number.isFinite(A.lat) ||
        !Number.isFinite(A.lng) ||
        !Number.isFinite(B.lat) ||
        !Number.isFinite(B.lng)
      )
        return true;

      const distABm = haversineLocal(A.lat, A.lng, B.lat, B.lng);
      const distABkm = distABm / 1000;

      const headingAB = bearingDegLocal(A.lat, A.lng, B.lat, B.lng);
      const diffAB = angleDiffDegLocal(mainHeadingDeg, headingAB);

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
          mainHeadingDeg = bearingDegLocal(
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

        b.destinationTodaId = b.destinationTodaId ? String(b.destinationTodaId) : null;
        b.candidateTodaIds = Array.isArray(b.candidateTodaIds)
          ? b.candidateTodaIds.map((id) => String(id))
          : [];

        b.passengerZoneTag = b.passengerZoneTag || "FAR";

        return b;
      })
      .filter((b) => {
        const keep = b._distKm <= rad;
        return keep;
      });



    let filtered = filteredBase;

    // 2) TODA restriction (TODA vs Roaming, with rejection rules)
    if (driverId) {
      filtered = await todaAwareFilterForDriver(filtered, driverId);
    } else {
    }

    // 3) AI direction filter
    filtered = filtered.filter((b) => {
      if (!aiMode || mainHeadingDeg == null) return true;

      const dLat = Number(b.destinationLat);
      const dLng = Number(b.destinationLng);

      if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return true;

      const candHeading = bearingDegLocal(center.lat, center.lng, dLat, dLng);
      const diff = angleDiffDegLocal(mainHeadingDeg, candHeading);

      if (diff > 120) {
        if (DEBUG_WAITING) {
        }
        return false;
      }

      if (activeMainDestLat != null && activeMainDestLng != null) {
        const ok = isDestinationCompatibleLocal(
          { lat: activeMainDestLat, lng: activeMainDestLng },
          { lat: dLat, lng: dLng },
          mainHeadingDeg
        );
        if (!ok) {
          return false;
        }
      }


      return true;
    });

    // 4) sort + limit + shape output
    filtered = filtered
      .sort((a, b) => a._distKm - b._distKm)
      .slice(0, lim);

    const shaped = filtered.map((b) => {
      const id = b.bookingId || String(b._id);

      const fareBreakdown = b.fareBreakdown || {};
      const baseFare = Number(fareBreakdown.baseFare || 0);
      const addlPerKm = Number(fareBreakdown.addlPerKm || 0);
      const discountApplied = Number(fareBreakdown.discountApplied || 0);
      const distanceKm = Number(b.distanceKm || fareBreakdown.distanceKm || 0);

      const baseKm =
        String(b.bookingType || "CLASSIC").toUpperCase() === "SOLO"
          ? 2
          : 2;

      const additionalUnits =
        distanceKm > 0 ? Math.ceil(Math.max(0, distanceKm - baseKm)) : 0;

      const additionalFare = additionalUnits * addlPerKm;
      const originalFare = baseFare + additionalFare;
      const discountAmount =
        discountApplied > 0 ? (originalFare * discountApplied) / 100 : 0;

      return {
        id,
        bookingId: id,

        fare: Number(b.fare || 0),

        pickup: { lat: b.pickupLat, lng: b.pickupLng },
        destination: { lat: b.destinationLat, lng: b.destinationLng },

        pickupPlace: b.pickupPlace || "",
        destinationPlace: b.destinationPlace || "",

        passengerPreview: {
          name: b.passengerName || "Passenger",
          bookedFor: !!b.bookedFor,
          riderName: b.riderName || "",
          riderPhone: b.riderPhone || "",
        },

        bookingType: b.bookingType || "CLASSIC",
        partySize: b.partySize || 1,

        fareBreakdown: {
          distanceKm,
          baseFare,
          additionalFare,
          originalFare,
          discountApplied,
          discountAmount,
          totalFare: Number(b.fare || 0),
        },
      };
    });

    return res.json(shaped);
  } catch (err) {
    console.error("❌ waiting-bookings error:", err);
    res.status(500).json([]);
  }
});

// ---------- GET /driver-requests/:driverId ----------
router.get("/driver-requests/:driverId", requireUserAuth, async (req, res) => {
  try {
    const { driverId } = req.params;
    if (req.user.role !== "driver" || req.user.sub !== driverId) {
      return res.status(403).json({ message: "Forbidden" });
    }
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
router.post("/accept-booking", requireUserAuth, async (req, res) => {
  try {
    const { bookingId, driverLat, driverLng } = req.body;

    if (req.user.role !== "driver") {
      return res.status(403).json({ message: "Drivers only" });
    }

    const driverId = req.user.sub;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId is required" });
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
          progressStatus: "to_pickup",
        },
      }
    );

    // 🔵 If this is a GCash ride, snapshot driver's payment info into the booking
    try {
      const method = String(result.booking?.paymentMethod || "").toLowerCase();
      if (method === "gcash") {
        const d = await Driver.findById(driverId).select(
          "gcashNumber gcashQRUrl gcashQRPublicId"
        );
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

    // 🔄 Return fresh booking
    const fresh = await Booking.findOne({ bookingId }).lean();

    // ✅ Create driver tasks (Pickup + Dropoff) for task-based routing UI
    // Rule: BOTH tasks start as PENDING. Then we run replan to pick ONE ACTIVE.
    // Idempotent: only create if tasks do not already exist for this booking
    try {
      if (fresh) {
        const existingCount = await Task.countDocuments({
          sourceType: "BOOKING",
          sourceId: String(fresh.bookingId),
        });

        if (existingCount === 0) {
          const pickupTask = await Task.create({
            driverId: String(driverId),
            sourceType: "BOOKING",
            sourceId: String(fresh.bookingId),
            taskType: "PICKUP",
            lat: Number(fresh.pickupLat),
            lng: Number(fresh.pickupLng),
            place: fresh.pickupPlace || "",
            status: "PENDING",
            meta: { passengerId: String(fresh.passengerId || "") },
          });

          await Task.create({
            driverId: String(driverId),
            sourceType: "BOOKING",
            sourceId: String(fresh.bookingId),
            taskType: "DROPOFF",
            lat: Number(fresh.destinationLat),
            lng: Number(fresh.destinationLng),
            place: fresh.destinationPlace || "",
            dependsOnTaskId: pickupTask._id,
            status: "PENDING",
            meta: { passengerId: String(fresh.passengerId || "") },
          });
        }

        // ✅ After tasks exist: select ONE ACTIVE eligible task (nearest)
        let lat = Number(driverLat);
        let lng = Number(driverLng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          try {
            const ds2 = await DriverStatus.findOne({
              driverId: new mongoose.Types.ObjectId(driverId),
            })
              .select("location")
              .lean();
            lat = Number(ds2?.location?.latitude);
            lng = Number(ds2?.location?.longitude);
          } catch {}
        }

        await enforceSingleActiveAndPickNearest(driverId, lat, lng);
      }
    } catch (e) {
      console.warn("Task creation/replan failed:", e?.message || e);
    }

    // 🔔 send push notification to passenger
    try {
      if (fresh && fresh.passengerId) {
        const passenger = await Passenger.findById(fresh.passengerId).select("pushToken");
        if (passenger?.pushToken) {
          await sendPush(
            passenger.pushToken,
            "TODA Go",
            "A driver accepted your booking.",
            { bookingId: fresh.bookingId, driverId: String(driverId) }
          );
        }
      }
    } catch (err) {
      console.error("❌ Error sending accept-booking push:", err);
    }

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
    const { bookingId, cancelledBy, driverLat, driverLng } = req.body;

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId required" });
    }

    const b = await Booking.findOne({ bookingId }).lean();
    if (!b) return res.status(404).json({ message: "Booking not found" });

    // If it was accepted and has a driver, release seats
    if (b.status === "accepted" && b.driverId) {
      await releaseSeats({ driverId: b.driverId, booking: b, reason: "cancel" });
    }

    // ✅ cancel all open tasks for this booking (keep completed as history)
    await Task.updateMany(
      {
        sourceType: "BOOKING",
        sourceId: String(bookingId),
        status: { $in: ["PENDING", "ACTIVE"] },
      },
      { $set: { status: "CANCELED" } }
    );

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

    // ✅ replan (pick next ACTIVE task among remaining bookings)
    if (b.driverId) {
      let lat = Number(driverLat);
      let lng = Number(driverLng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        try {
          const ds2 = await DriverStatus.findOne({
            driverId: new mongoose.Types.ObjectId(b.driverId),
          })
            .select("location")
            .lean();
          lat = Number(ds2?.location?.latitude);
          lng = Number(ds2?.location?.longitude);
        } catch {}
      }

      try {
        await enforceSingleActiveAndPickNearest(b.driverId, lat, lng);
      } catch (e) {
        console.warn("cancel-booking replan failed:", e?.message || e);
      }
    }

    // 🔔 Notify driver ONLY if passenger cancelled and there is a driver
    try {
      const by = (cancelledBy || "passenger").toLowerCase();
      if ((by === "passenger" || !cancelledBy) && b.driverId) {
        const driver = await Driver.findById(b.driverId).select("pushToken");
        if (driver?.pushToken) {
          await sendPush(
            driver.pushToken,
            "Booking Cancelled",
            "The passenger has cancelled the booking.",
            {
              bookingId: updated?.bookingId || bookingId,
              passengerId: String(b.passengerId || ""),
            }
          );
        }
      }
    } catch (err) {
      console.error("❌ Error sending cancel notification to driver:", err);
    }

    return res.status(200).json({ message: "Booking cancelled", booking: updated });
  } catch (e) {
    console.error("❌ cancel-booking error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------- POST /complete-booking ----------
router.post("/complete-booking", requireUserAuth, async (req, res) => {
  try {
    if (req.user.role !== "driver") {
      return res.status(403).json({ message: "Drivers only" });
    }

    const authDriverId = String(req.user.sub || "");
    const { bookingId, driverLat, driverLng } = req.body || {};

    if (!bookingId) {
      return res.status(400).json({ message: "bookingId required" });
    }

    const b = await Booking.findOne({ bookingId }).lean();

    if (!b) return res.status(404).json({ message: "Booking not found" });

    if (String(b.driverId || "") !== authDriverId) {
      return res.status(403).json({ message: "Not your booking" });
    }

    // If accepted/enroute and has a driver, release seats
    if ((b.status === "accepted" || b.status === "enroute") && b.driverId) {
      await releaseSeats({ driverId: b.driverId, booking: b, reason: "complete" });
    }

    // ✅ cancel all open tasks for this booking (keep completed as history)
    await Task.updateMany(
      {
        sourceType: "BOOKING",
        sourceId: String(bookingId),
        status: { $in: ["PENDING", "ACTIVE"] },
      },
      { $set: { status: "CANCELED" } }
    );

    const updated = await Booking.findOneAndUpdate(
      { bookingId },
      {
        $set: {
          status: "completed",
          progressStatus: null,
          completedAt: new Date(),
          reservationExpiresAt: null,
          driverLock: false,
        },
      },
      { new: true }
    );

    // ✅ replan (pick next ACTIVE task among remaining bookings)
    if (b.driverId) {
      let lat = Number(driverLat);
      let lng = Number(driverLng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        try {
          const ds2 = await DriverStatus.findOne({
            driverId: new mongoose.Types.ObjectId(b.driverId),
          })
            .select("location")
            .lean();
          lat = Number(ds2?.location?.latitude);
          lng = Number(ds2?.location?.longitude);
        } catch {}
      }

      try {
        await enforceSingleActiveAndPickNearest(b.driverId, lat, lng);
      } catch (e) {
        console.warn("complete-booking replan failed:", e?.message || e);
      }
    }

    // --- your RideHistory save block stays the same ---
    try {
      const niceType = ((t) => {
        const up = String(t || "CLASSIC").toUpperCase();
        if (up === "GROUP") return "Group";
        if (up === "SOLO") return "Solo";
        return "Classic";
      })(updated.bookingType);

      const seats = Number(updated.partySize || 1);
      const baseFare = Number(updated.fare || 0);
      const totalFare = niceType === "Group" ? baseFare * (Number.isFinite(seats) ? seats : 1) : baseFare;

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

        bookedFor: !!updated.bookedFor,
        riderName: updated.riderName || null,
        riderPhone: updated.riderPhone || null,

        completedAt: new Date(),
      });
    } catch (e) {
      console.error("❌ Error saving ride history:", e);
    }

    // 🔔 passenger push
    try {
      if (updated && updated.passengerId) {
        const passenger = await Passenger.findById(updated.passengerId).select("pushToken");
        if (passenger?.pushToken) {
          await sendPush(
            passenger.pushToken,
            "Trip Complete",
            "Your trip is completed. Thank you for riding!",
            {
              bookingId: updated.bookingId,
              driverId: String(updated.driverId || ""),
            }
          );
        }
      }
    } catch (err) {
      console.error("❌ Error sending complete-booking push:", err);
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

router.post("/passenger/push-token", async (req, res) => {
  try {
    const { passengerId, pushToken } = req.body;
    if (!passengerId || !pushToken) {
      return res.status(400).json({ error: "Missing passengerId or pushToken" });
    }

    await Passenger.findByIdAndUpdate(
      passengerId,
      { pushToken },
      { new: true }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("Save push token failed:", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/driver/push-token", requireUserAuth, async (req, res) => {
  try {
    const { pushToken } = req.body;
    const driverId = String(req.user.sub || "");
    if (!driverId || !pushToken) {
      return res.status(400).json({ error: "Missing driverId or pushToken" });
    }

    await Driver.findByIdAndUpdate(
      driverId,
      { pushToken },
      { new: true }
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("Save driver push token failed:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- (Optional) GET /bookings — debug only ----------
router.get("/bookings", requireUserAuth, async (req, res) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    const userId = String(req.user?.sub || "");

    let rows = [];

    if (role === "admin" || role === "super_admin") {
      rows = await Booking.find({}).sort({ createdAt: -1 }).lean();
    } else if (role === "passenger") {
      rows = await Booking.find({ passengerId: userId }).sort({ createdAt: -1 }).lean();
    } else if (role === "driver") {
      rows = await Booking.find({ driverId: userId }).sort({ createdAt: -1 }).lean();
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }

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

router.post("/booking/:bookingId/payment-status", requireUserAuth, async (req, res) => {
  if (!["driver", "passenger"].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }
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
