const express = require("express");
const router = express.Router();
const FareConfig = require("../models/FareConfig");

router.get("/public/farematrix", async (req, res) => {
  try {
    console.log("🔥 HIT PUBLIC FARE CONFIG FILE");
    console.log("🔥 FARE PUBLIC PATH =", req.path);
    console.log("🔥 FARE PUBLIC ORIGINAL URL =", req.originalUrl);

    const config = await FareConfig.getSingleton();

    return res.json({
        ok: true,
        source: "PublicFareConfig.js",
        debugVersion: "fare-public-v1",
        regular: config.regular,
        special: config.special,
        discounts: config.discounts,
        lastUpdatedAt: config.lastUpdatedAt,
    });
  } catch (err) {
    console.error("GET /public/fare-config error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to load fare configuration.",
    });
  }
});

module.exports = router;