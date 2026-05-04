const express = require("express");
const axios = require("axios");

const router = express.Router();

const LUCENA_LAT = 13.9414;
const LUCENA_LNG = 121.6236;
const MAX_DISTANCE_KM_FROM_LUCENA = 18;

function toRad(value) {
  return (Number(value) * Math.PI) / 180;
}

function distanceKm(aLat, aLng, bLat, bLng) {
  const nALat = Number(aLat);
  const nALng = Number(aLng);
  const nBLat = Number(bLat);
  const nBLng = Number(bLng);

  if (
    !Number.isFinite(nALat) ||
    !Number.isFinite(nALng) ||
    !Number.isFinite(nBLat) ||
    !Number.isFinite(nBLng)
  ) {
    return Infinity;
  }

  const R = 6371;
  const dLat = toRad(nBLat - nALat);
  const dLng = toRad(nBLng - nALng);

  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(nALat)) *
      Math.cos(toRad(nBLat)) *
      Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

function isNearLucena(lat, lng) {
  return (
    distanceKm(LUCENA_LAT, LUCENA_LNG, Number(lat), Number(lng)) <=
    MAX_DISTANCE_KM_FROM_LUCENA
  );
}

function labelLooksLucena(label = "") {
  const text = String(label).toLowerCase();

  return (
    text.includes("lucena") ||
    text.includes("quezon") ||
    text.includes("gulang-gulang") ||
    text.includes("cotta") ||
    text.includes("dalahican") ||
    text.includes("mayao") ||
    text.includes("isabang") ||
    text.includes("ibabang") ||
    text.includes("ilayang") ||
    text.includes("market view") ||
    text.includes("talipan")
  );
}

// GET /api/geocode?q=sm lucena&lat=13.94&lng=121.62
router.get("/api/geocode", async (req, res) => {
  const { q, lat, lng, lon } = req.query;

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

  const focusLat = Number(lat);
  const focusLng = Number(lng ?? lon);

  const safeFocusLat = Number.isFinite(focusLat) ? focusLat : LUCENA_LAT;
  const safeFocusLng = Number.isFinite(focusLng) ? focusLng : LUCENA_LNG;

  const url = new URL("https://api.openrouteservice.org/geocode/autocomplete");

  url.searchParams.set("api_key", ORS_KEY);

  // Keep query simple but biased to Lucena.
  const text =
    query.toLowerCase().includes("lucena")
      ? query
      : `${query}, Lucena City, Quezon, Philippines`;

  url.searchParams.set("text", text);
  url.searchParams.set("size", "8");

  // Focus around passenger if available; otherwise Lucena center.
  url.searchParams.set("focus.point.lat", String(safeFocusLat));
  url.searchParams.set("focus.point.lon", String(safeFocusLng));

  // Hard safety boundary around Lucena.
  url.searchParams.set("boundary.circle.lat", String(LUCENA_LAT));
  url.searchParams.set("boundary.circle.lon", String(LUCENA_LNG));
  url.searchParams.set(
    "boundary.circle.radius",
    String(MAX_DISTANCE_KM_FROM_LUCENA)
  );

  url.searchParams.set("boundary.country", "PH");

  try {
    const r = await axios.get(url.toString(), {
      timeout: 10000,
    });

    const rawItems = Array.isArray(r.data?.features) ? r.data.features : [];

    const items = rawItems
      .map((f) => {
        const coords = f.geometry?.coordinates || [];
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        const label = f.properties?.label || f.properties?.name || "";

        return {
          label,
          lat,
          lng,
          distanceKmFromLucena: distanceKm(LUCENA_LAT, LUCENA_LNG, lat, lng),
        };
      })
      .filter((item) => {
        return (
          Number.isFinite(item.lat) &&
          Number.isFinite(item.lng) &&
          (isNearLucena(item.lat, item.lng) || labelLooksLucena(item.label))
        );
      })
      .sort((a, b) => a.distanceKmFromLucena - b.distanceKmFromLucena)
      .slice(0, 5)
      .map((item) => ({
        label: item.label,
        lat: item.lat,
        lng: item.lng,
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