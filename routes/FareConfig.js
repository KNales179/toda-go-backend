const express = require("express");
const router = express.Router();
const FareConfig = require("../models/FareConfig");


router.get("/admin/fare-config",  async (req, res) => {
  try {
    const config = await FareConfig.getSingleton();
    res.json(config);
  } catch (err) {
    console.error("GET /admin/fare-config error:", err);
    res.status(500).json({ message: "Failed to load fare configuration." });
  }
});


router.put("/admin/fare-config",  async (req, res) => {
  try {
    const payload = req.body;

    const config = await FareConfig.getSingleton();

    // Simple merge – only update fields that are sent from frontend
    if (payload.regular) {
      config.regular.baseKm =
        payload.regular.baseKm ?? config.regular.baseKm;
      config.regular.baseFare =
        payload.regular.baseFare ?? config.regular.baseFare;
      config.regular.addlPerKm =
        payload.regular.addlPerKm ?? config.regular.addlPerKm;
      config.regular.chargeMode =
        payload.regular.chargeMode ?? config.regular.chargeMode;
    }

    if (payload.special) {
      config.special.baseKm =
        payload.special.baseKm ?? config.special.baseKm;
      config.special.baseFare =
        payload.special.baseFare ?? config.special.baseFare;
      config.special.shortKm =
        payload.special.shortKm ?? config.special.shortKm;
      config.special.shortFare =
        payload.special.shortFare ?? config.special.shortFare;
      config.special.addlPerKm =
        payload.special.addlPerKm ?? config.special.addlPerKm;
      config.special.chargeMode =
        payload.special.chargeMode ?? config.special.chargeMode;
    }

    if (payload.discounts) {
      if (typeof payload.discounts.enabled === "boolean") {
        config.discounts.enabled = payload.discounts.enabled;
      }
      if (payload.discounts.percent !== undefined) {
        config.discounts.percent = payload.discounts.percent;
      }
      if (Array.isArray(payload.discounts.appliesTo)) {
        config.discounts.appliesTo = payload.discounts.appliesTo;
      }
    }

    config.lastUpdatedAt = new Date();

    await config.save();

    res.json(config);
  } catch (err) {
    console.error("PUT /admin/fare-config error:", err);
    res.status(500).json({ message: "Failed to update fare configuration." });
  }
});

module.exports = router;
