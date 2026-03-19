const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const router = express.Router();

const RideHistory = require("../models/RideHistory");
const Booking = require("../models/Bookings");
const Driver = require("../models/Drivers"); 
const Passenger = require("../models/Passenger"); 
const requireUserAuth = require("../middleware/requireUserAuth");
const requireAdminAuth = require("../middleware/requireAdminAuth");
async function reverseGeocodeORS(lat, lng) {
  try {
    if (!process.env.ORS_API_KEY) {
      console.warn("⚠️ ORS_API_KEY not set — skipping reverse geocode");
      return null;
    }

    // ORS reverse geocode endpoint expects point.lon and point.lat
    const url = "https://api.openrouteservice.org/geocode/reverse";
    const params = {
      api_key: process.env.ORS_API_KEY,
      point_lat: String(lat),
      point_lon: String(lng),
      size: 1,
    };

    const r = await axios.get(url, { params, timeout: 5000 });

    const feat = r.data?.features?.[0];
    if (!feat) return null;

    // prefer properties.label if present, otherwise construct from components
    const label = feat.properties?.label;
    if (label && String(label).trim()) return String(label).trim();

    const props = feat.properties || {};
    const parts = [
      props.name,
      props.street,
      props.housenumber,
      props.locality,
      props.county,
      props.region,
      props.country,
    ].filter(Boolean);

    if (parts.length) return parts.join(", ");

    return null;
  } catch (e) {
    return null;
  }
}

router.get("/admin/trips", requireAdminAuth, async (req, res) => {
  try {
    const role = String(req.admin?.role || "").toLowerCase();

    if (role !== "admin" && role !== "super_admin") {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    // ---------------------------------
    // 1) Load non-completed bookings
    // ---------------------------------
    const bookings = await Booking.find({
      status: { $in: ["pending", "accepted", "canceled", "cancelled", "enroute"] },
    })
      .sort({ createdAt: -1, _id: -1 })
      .lean();

    // ---------------------------------
    // 2) Load completed trips from RideHistory
    // ---------------------------------
    const completedRides = await RideHistory.find()
      .sort({ completedAt: -1, _id: -1 })
      .lean();

    // ---------------------------------
    // 3) Collect unique driver/passenger IDs from both sources
    // ---------------------------------
    const allDriverIds = [
      ...new Set(
        [...bookings, ...completedRides]
          .map((x) => x.driverId)
          .filter(Boolean)
          .map(String)
      ),
    ];

    const allPassengerIds = [
      ...new Set(
        [...bookings, ...completedRides]
          .map((x) => x.passengerId)
          .filter(Boolean)
          .map(String)
      ),
    ];

    const driverObjectIds = allDriverIds
      .map((id) =>
        mongoose.Types.ObjectId.isValid(id)
          ? new mongoose.Types.ObjectId(id)
          : null
      )
      .filter(Boolean);

    const passengerObjectIds = allPassengerIds
      .map((id) =>
        mongoose.Types.ObjectId.isValid(id)
          ? new mongoose.Types.ObjectId(id)
          : null
      )
      .filter(Boolean);

    // ---------------------------------
    // 4) Build driver name map
    // ---------------------------------
    const driversById = new Map();
    if (driverObjectIds.length) {
      const drivers = await Driver.find({ _id: { $in: driverObjectIds } })
        .select("driverName driverFirstName driverMiddleName driverLastName")
        .lean();

      drivers.forEach((d) => {
        const fullName =
          d.driverName ||
          [d.driverFirstName, d.driverMiddleName, d.driverLastName]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        driversById.set(String(d._id), fullName || "Driver");
      });
    }

    // ---------------------------------
    // 5) Build passenger name map
    // ---------------------------------
    const passengersById = new Map();
    if (passengerObjectIds.length) {
      const passengers = await Passenger.find({ _id: { $in: passengerObjectIds } })
        .select("firstName middleName lastName")
        .lean();

      passengers.forEach((p) => {
        const fullName = [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        passengersById.set(String(p._id), fullName || "Passenger");
      });
    }

    // ---------------------------------
    // 6) Normalize live bookings
    // ---------------------------------
    const bookingItems = bookings.map((b) => {
      const rawStatus = String(b.status || "pending").toLowerCase();

      return {
        source: "booking",
        _id: String(b._id),
        bookingId: b.bookingId || "",
        passengerId: b.passengerId ? String(b.passengerId) : null,
        passengerName:
          passengersById.get(String(b.passengerId)) ||
          b.passengerName ||
          "Passenger",

        driverId: b.driverId ? String(b.driverId) : null,
        driverName: b.driverId
          ? driversById.get(String(b.driverId)) || "Driver"
          : "Unassigned",

        pickupLabel:
          b.pickupPlace ||
          b.pickupLabel ||
          b.pickupName ||
          b.pickupAddress ||
          "Pickup location",

        destinationLabel:
          b.destinationPlace ||
          b.destinationLabel ||
          b.destinationName ||
          b.destinationAddress ||
          "Destination",

        pickupPlace: b.pickupPlace || "",
        destinationPlace: b.destinationPlace || "",

        fare: b.fare ?? 0,
        totalFare:
          b.totalFare != null
            ? b.totalFare
            : b.bookingType === "GROUP"
            ? Number(b.fare || 0) * Number(b.partySize || 1)
            : Number(b.fare || 0),

        paymentMethod: b.paymentMethod || "",
        paymentStatus: b.paymentStatus || "",
        notes: b.notes || "",

        bookingType: String(b.bookingType || "CLASSIC").toLowerCase(),
        groupCount: Number(b.partySize || 1),

        bookedFor: !!b.bookedFor,
        riderName: b.riderName || "",
        riderPhone: b.riderPhone || "",

        status: rawStatus,
        createdAt: b.createdAt || null,
        acceptedAt: b.acceptedAt || null,
        completedAt: null,
        canceledAt: b.canceledAt || null,
      };
    });

    // ---------------------------------
    // 7) Normalize completed ride history
    // ---------------------------------
    const rideItems = completedRides.map((r) => {
      return {
        source: "ridehistory",
        _id: String(r._id),
        bookingId: r.bookingId || "",
        passengerId: r.passengerId ? String(r.passengerId) : null,
        passengerName:
          passengersById.get(String(r.passengerId)) ||
          r.passengerName ||
          "Passenger",

        driverId: r.driverId ? String(r.driverId) : null,
        driverName:
          driversById.get(String(r.driverId)) ||
          r.driverName ||
          "Driver",

        pickupLabel:
          r.pickupPlace ||
          r.pickupLabel ||
          r.pickupName ||
          r.pickupAddress ||
          "Pickup location",

        destinationLabel:
          r.destinationPlace ||
          r.destinationLabel ||
          r.destinationName ||
          r.destinationAddress ||
          "Destination",

        pickupPlace: r.pickupPlace || "",
        destinationPlace: r.destinationPlace || "",

        fare: r.fare ?? 0,
        totalFare: r.totalFare != null ? r.totalFare : r.fare ?? 0,

        paymentMethod: r.paymentMethod || "",
        paymentStatus: r.paymentStatus || "",
        notes: r.notes || "",

        bookingType: String(r.bookingType || "classic").toLowerCase(),
        groupCount: Number(r.groupCount || 1),

        bookedFor: !!r.bookedFor,
        riderName: r.riderName || "",
        riderPhone: r.riderPhone || "",

        status: "completed",
        createdAt: r.createdAt || r.completedAt || null,
        acceptedAt: null,
        completedAt: r.completedAt || null,
        canceledAt: null,
      };
    });

    // ---------------------------------
    // 8) Merge + sort
    // ---------------------------------
    const items = [...bookingItems, ...rideItems].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    return res.status(200).json({
      ok: true,
      items,
      total: items.length,
    });
  } catch (error) {
    console.error("❌ Failed to fetch admin trips:", error);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/rides", requireAdminAuth, async (req, res) => {
  try {
    const role = String(req.admin?.role || "").toLowerCase();

    if (role !== "admin" && role !== "super_admin") {
      return res.status(403).json({ error: "forbidden" });
    }

    const rides = await RideHistory.find()
      .sort({ completedAt: -1, _id: -1 })
      .lean();

    // -----------------------------
    // Map driver IDs -> names
    // -----------------------------
    const driverIds = [...new Set(rides.map((r) => r.driverId).filter(Boolean))];

    const driverObjectIds = driverIds
      .map((id) =>
        mongoose.Types.ObjectId.isValid(id)
          ? new mongoose.Types.ObjectId(id)
          : null
      )
      .filter(Boolean);

    let driversById = new Map();
    if (driverObjectIds.length) {
      const drivers = await Driver.find({ _id: { $in: driverObjectIds } })
        .select("driverName driverFirstName driverMiddleName driverLastName")
        .lean();

      drivers.forEach((d) => {
        const fullName =
          d.driverName ||
          [d.driverFirstName, d.driverMiddleName, d.driverLastName]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        driversById.set(String(d._id), fullName || "Driver");
      });
    }

    // -----------------------------
    // Map passenger IDs -> names
    // -----------------------------
    const passengerIds = [...new Set(rides.map((r) => r.passengerId).filter(Boolean))];

    const passengerObjectIds = passengerIds
      .map((id) =>
        mongoose.Types.ObjectId.isValid(id)
          ? new mongoose.Types.ObjectId(id)
          : null
      )
      .filter(Boolean);

    let passengersById = new Map();
    if (passengerObjectIds.length) {
      const passengers = await Passenger.find({ _id: { $in: passengerObjectIds } })
        .select("firstName middleName lastName")
        .lean();

      passengers.forEach((p) => {
        const fullName = [p.firstName, p.middleName, p.lastName]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        passengersById.set(String(p._id), fullName || "Passenger");
      });
    }

    // -----------------------------
    // Build items
    // -----------------------------
    const items = rides.map((r) => {
      const pickupLabel =
        r.pickupPlace ||
        r.pickupLabel ||
        r.pickupName ||
        r.pickupAddress ||
        "Pickup location";

      const destinationLabel =
        r.destinationPlace ||
        r.destinationLabel ||
        r.destinationName ||
        r.destinationAddress ||
        "Destination";

      return {
        _id: String(r._id),
        bookingId: r.bookingId || "",
        passengerId: r.passengerId || null,
        passengerName:
          passengersById.get(String(r.passengerId)) ||
          r.passengerName ||
          "Passenger",

        driverId: r.driverId ? String(r.driverId) : null,
        driverName:
          driversById.get(String(r.driverId)) ||
          r.driverName ||
          "Driver",

        pickupLabel,
        destinationLabel,

        pickupPlace: r.pickupPlace || "",
        destinationPlace: r.destinationPlace || "",

        fare: r.fare ?? 0,
        totalFare: r.totalFare != null ? r.totalFare : r.fare ?? 0,

        bookingType: r.bookingType || "",
        groupCount: r.groupCount ?? 1,
        paymentMethod: r.paymentMethod || "",
        notes: r.notes || "",

        bookedFor: !!r.bookedFor,
        riderName: r.riderName || "",
        riderPhone: r.riderPhone || "",

        createdAt: r.completedAt || r.createdAt || null,
        completedAt: r.completedAt || null,
      };
    });

    return res.status(200).json({ items, total: items.length });
  } catch (error) {
    console.error("❌ Failed to fetch all ride history:", error);
    return res.status(500).json({ error: "server_error" });
  }
});

/* PASSENGER/DRIVER — sanitized: returns driverName only (no driverId)
   plus server-side reverse geocoding for missing place names */
router.get("/ridehistory", requireUserAuth, async (req, res) => {
  try {
    const role = String(req.user?.role || "").toLowerCase();
    const userId = String(req.user?.sub || "").trim();
    const filter = {};

    if (role === "passenger") {
      filter.passengerId = userId;
    } else if (role === "driver") {
      filter.driverId = userId;
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rides = await RideHistory.find(filter)
      .sort({ completedAt: -1, _id: -1 })
      .lean();

    if (rides.length > 0) {
    }

    // Map driver IDs -> names (one query)
    const driverIds = [...new Set(rides.map(r => r.driverId).filter(Boolean))];

    const toObjectIds = driverIds
      .map(id => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null))
      .filter(Boolean);

    let driversById = new Map();
    if (toObjectIds.length) {
      const drivers = await Driver.find({ _id: { $in: toObjectIds } })
        .select("driverName driverFirstName driverMiddleName driverLastName")
        .lean();

      drivers.forEach(d => {
        const composed =
          d.driverName ||
          [d.driverFirstName, d.driverMiddleName, d.driverLastName]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        driversById.set(String(d._id), composed || "Driver");
      });
    }

    // Map passenger IDs -> names (one query)
    const passengerIds = [...new Set(rides.map(r => r.passengerId).filter(Boolean))];

    const passengerObjectIds = passengerIds
      .map(id =>
        mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null
      )
      .filter(Boolean);

    let passengersById = new Map();
    if (passengerObjectIds.length) {
      const passengers = await Passenger.find({ _id: { $in: passengerObjectIds } })
        .select("firstName middleName lastName")
        .lean();

      passengers.forEach(p => {
        const full =
          [p.firstName, p.middleName, p.lastName]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim() || "Passenger";
        passengersById.set(String(p._id), full);
      });
    }



    // --------------- Build items but keep coords available for geocoding ---------------
    // We'll collect distinct coords (that lack place names) and reverse geocode them in batch.
    // Use a Map keyed by "lat,lng" to dedupe.
    const coordKey = (lat, lng) => {
      if (lat == null || lng == null) return null;
      return `${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
    };

    const coordsToResolve = new Map(); // key -> { lat, lng }
    const itemsPre = rides.map(r => {
      const pickupPlace = r.pickupPlace ?? null;
      const destinationPlace = r.destinationPlace ?? null;

      // capture coords if place is missing
      const pkKey = !pickupPlace ? coordKey(r.pickupLat, r.pickupLng) : null;
      const dstKey = !destinationPlace ? coordKey(r.destinationLat, r.destinationLng) : null;
      if (pkKey) coordsToResolve.set(pkKey, { lat: Number(r.pickupLat), lng: Number(r.pickupLng) });
      if (dstKey) coordsToResolve.set(dstKey, { lat: Number(r.destinationLat), lng: Number(r.destinationLng) });

      const driverName = driversById.get(String(r.driverId)) || "Driver";
      const passengerName = passengersById.get(String(r.passengerId)) || "Passenger";

      return {
        raw: r, // keep original doc for reference
        _id: String(r._id),
        bookingId: r.bookingId,
        passengerId: r.passengerId,
        pickupPlace,       // may be null
        destinationPlace,  // may be null
        pickupLat: (Number.isFinite(r.pickupLat) ? Number(r.pickupLat) : null),
        pickupLng: (Number.isFinite(r.pickupLng) ? Number(r.pickupLng) : null),
        destinationLat: (Number.isFinite(r.destinationLat) ? Number(r.destinationLat) : null),
        destinationLng: (Number.isFinite(r.destinationLng) ? Number(r.destinationLng) : null),
        fare: r.fare ?? 0,
        totalFare: r.totalFare != null ? r.totalFare : undefined,
        bookingType: r.bookingType,
        groupCount: r.groupCount ?? undefined,
        paymentMethod: r.paymentMethod || "",
        notes: r.notes || "",
        createdAt: r.completedAt || r.createdAt || new Date(),
        driverName,
        passengerName,
      };
    });

    // --------------- Reverse geocode distinct coords (with simple concurrency control) ---------------
    const resolvedMap = new Map(); // key -> label
    if (coordsToResolve.size > 0) {
      // Build tasks array
      const tasks = Array.from(coordsToResolve.entries()).map(([key, { lat, lng }]) => ({ key, lat, lng }));

      // Limit concurrency to avoid hammering ORS (conservative)
      const CONCURRENCY = 4;
      let idx = 0;

      const worker = async () => {
        while (idx < tasks.length) {
          const i = idx++;
          const t = tasks[i];
          try {
            const label = await reverseGeocodeORS(t.lat, t.lng);
            if (label && String(label).trim()) {
              resolvedMap.set(t.key, String(label).trim());
            } else {
              // fallback to readable coordinate string
              resolvedMap.set(t.key, `${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}`);
            }
            // small delay to be polite (prevent short bursts; adjust if you have higher rate allowance)
            await new Promise(r => setTimeout(r, 75));
          } catch (e) {
            console.warn("❌ geocode worker error for", t.key, e?.message || e);
            resolvedMap.set(t.key, `${t.lat.toFixed(5)}, ${t.lng.toFixed(5)}`);
          }
        }
      };

      // run workers
      const workers = [];
      for (let w = 0; w < CONCURRENCY; w++) workers.push(worker());
      await Promise.all(workers);
    }

    // --------------- Map final items (inject resolved place names where missing) ---------------
    const items = itemsPre.map(entry => {
      const r = entry.raw;
      const pkKey = coordKey(entry.pickupLat, entry.pickupLng);
      const dstKey = coordKey(entry.destinationLat, entry.destinationLng);

      const pickupLabel =
        entry.pickupPlace ||
        entry.raw.pickupLabel ||
        entry.raw.pickupName ||
        entry.raw.pickupAddress ||
        (pkKey ? (resolvedMap.get(pkKey) || "Pickup location") : "Pickup location");

      const destinationLabel =
        entry.destinationPlace ||
        entry.raw.destinationLabel ||
        entry.raw.destinationName ||
        entry.raw.destinationAddress ||
        (dstKey ? (resolvedMap.get(dstKey) || "Destination") : "Destination");

      return {
        _id: entry._id,
        bookingId: entry.bookingId,
        passengerId: entry.passengerId,
        driverId: r.driverId ? String(r.driverId) : null,
        pickupLabel,
        destinationLabel,
        fare: entry.fare ?? 0,
        totalFare: entry.totalFare,
        bookingType: entry.bookingType,
        groupCount: entry.groupCount,
        paymentMethod: entry.paymentMethod,
        notes: entry.notes,
        createdAt: entry.createdAt,
        driverName: entry.driverName,
        passengerName: entry.passengerName, 
        // optionally return coords if frontend needs them (commented out):
        // pickupLat: entry.pickupLat, pickupLng: entry.pickupLng,
        // destinationLat: entry.destinationLat, destinationLng: entry.destinationLng,
      };
    });

    res.json({ items, total: items.length });
  } catch (error) {
    console.error("❌ Failed to fetch user ride history:", error);
    res.status(500).json({ error: "server_error" });
  }
});

router.delete("/ridehistory/:id", requireUserAuth, async (req, res) => {
  const { id } = req.params;
  const role = String(req.user?.role || "").toLowerCase();
  const userId = String(req.user?.sub || "");
  try {

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }

    const ride = await RideHistory.findById(id).lean();

    if (!ride) {
      return res.status(404).json({ error: "not_found" });
    }

    if (role === "passenger") {
      if (String(ride.passengerId || "") !== userId) {
        return res.status(403).json({ error: "forbidden" });
      }
    } else if (role === "driver") {
      if (String(ride.driverId || "") !== userId) {
        return res.status(403).json({ error: "forbidden" });
      }
    } else {
      return res.status(403).json({ error: "forbidden" });
    }

    const result = await RideHistory.deleteOne({ _id: new mongoose.Types.ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (e) {
    console.error("❌ delete error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;