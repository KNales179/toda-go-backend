const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const router = express.Router();

const RideHistory = require("../models/RideHistory");
const Driver = require("../models/Drivers"); 

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
    // non-fatal; log and return null
    console.warn("❌ reverseGeocodeORS failed:", (e.response && e.response.data) || e.message || e);
    return null;
  }
}

/* ADMIN — unchanged: returns all rides */
router.get("/rides", async (_req, res) => {
  try {
    const rides = await RideHistory.find().sort({ completedAt: -1 }).lean();
    res.status(200).json(rides);
  } catch (error) {
    console.error("❌ Failed to fetch all ride history:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* PASSENGER/DRIVER — sanitized: returns driverName only (no driverId)
   plus server-side reverse geocoding for missing place names */
router.get("/ridehistory", async (req, res) => {
  try {
    const { passengerId = "", driverId = "" } = req.query;
    const filter = {};
    if (passengerId) filter.passengerId = String(passengerId).trim();
    if (driverId) filter.driverId = String(driverId).trim();

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

router.delete("/ridehistory/:id", async (req, res) => {
  const { id } = req.params;
  try {

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "invalid_id" });
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