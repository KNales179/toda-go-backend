const express = require("express");
const axios = require("axios");
const router = express.Router();

// Lucena City center-ish coordinates
const LUCENA_LAT = 13.9414;
const LUCENA_LON = 121.6236;

// Safety radius around Lucena center.
// 18km gives enough allowance for barangays/near-boundary search results.
const MAX_DISTANCE_KM_FROM_LUCENA = 18;

function toRad(value) {
  return (value * Math.PI) / 180;
}

function distanceKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

function isNearLucena(lat, lon) {
  const nLat = Number(lat);
  const nLon = Number(lon);

  if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) {
    return false;
  }

  return distanceKm(LUCENA_LAT, LUCENA_LON, nLat, nLon) <= MAX_DISTANCE_KM_FROM_LUCENA;
}

function labelLooksLucena(label = "") {
  const text = String(label).toLowerCase();

  return (
    text.includes("lucena") ||
    text.includes("quezon") ||
    text.includes("ibabang") ||
    text.includes("ilayang") ||
    text.includes("gulang-gulang") ||
    text.includes("cotta") ||
    text.includes("dalahican") ||
    text.includes("mayao") ||
    text.includes("isabang") ||
    text.includes("market view") ||
    text.includes("talipan")
  );
}

// GET /api/geocode?q=sm lucena
router.get("/api/geocode", async (req, res) => {
  const { q } = req.query;

  if (!q || String(q).trim().length < 2) {
    return res.status(400).json({
      error: "Missing or too short q",
    });
  }

  const ORS_KEY = process.env.ORS_API_KEY;

  if (!ORS_KEY) {
    return res.status(500).json({
      error: "Server misconfig: ORS_API_KEY missing",
    });
  }

  const query = String(q).trim();

  const url = new URL("https://api.openrouteservice.org/geocode/autocomplete");
  url.searchParams.set("api_key", ORS_KEY);

  // Add Lucena to query to make autocomplete prefer Lucena results.
  url.searchParams.set("text", `${query}, Lucena City, Quezon, Philippines`);

  url.searchParams.set("size", "8");

  // Always focus search around Lucena.
  url.searchParams.set("focus.point.lat", String(LUCENA_LAT));
  url.searchParams.set("focus.point.lon", String(LUCENA_LON));

  // Restrict by boundary circle around Lucena.
  url.searchParams.set("boundary.circle.lat", String(LUCENA_LAT));
  url.searchParams.set("boundary.circle.lon", String(LUCENA_LON));
  url.searchParams.set("boundary.circle.radius", String(MAX_DISTANCE_KM_FROM_LUCENA));

  // Restrict to Philippines.
  url.searchParams.set("boundary.country", "PH");

  try {
    const r = await axios.get(url.toString(), {
      timeout: 10000,
    });

    const rawItems = Array.isArray(r.data?.features) ? r.data.features : [];

    const items = rawItems
      .map((f) => {
        const lon = f.geometry?.coordinates?.[0];
        const lat = f.geometry?.coordinates?.[1];
        const label = f.properties?.label || "";

        return {
          label,
          lat,
          lon,
          distanceKmFromLucena: distanceKm(LUCENA_LAT, LUCENA_LON, Number(lat), Number(lon)),
        };
      })
      .filter((item) => {
        return isNearLucena(item.lat, item.lon) || labelLooksLucena(item.label);
      })
      .sort((a, b) => a.distanceKmFromLucena - b.distanceKmFromLucena)
      .slice(0, 5)
      .map((item) => ({
        label: item.label,
        lat: item.lat,
        lon: item.lon,
      }));

    return res.json(items);
  } catch (e) {
    console.error("Geocode failed:", e.response?.data || e.message);

    return res.status(500).json({
      error: "Geocode failed",
      details: e.response?.data || e.message,
    });
  }
});

module.exports = router;