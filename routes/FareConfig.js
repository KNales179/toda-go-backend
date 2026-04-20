// FareConfig.js
const express = require("express");
const router = express.Router();
const FareConfig = require("../models/FareConfig");
const requireAdminAuth = require("../middleware/requireAdminAuth");

const ALLOWED_CHARGE_MODES = ["per_passenger", "per_trip"];
const ALLOWED_DISCOUNT_APPLIES_TO = ["student", "senior", "pwd"];

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * ADMIN READ
 * Used by admin panel
 */
router.get("/fare-config", async (req, res) => {
  try {
    const config = await FareConfig.getSingleton();
    res.json(config);
  } catch (err) {
    console.error("GET /admin/fare-config error:", err);
    res.status(500).json({ message: "Failed to load fare configuration." });
  }
});

/**
 * ADMIN UPDATE
 * Only admin can edit fare matrix
 */
router.put("/admin/fare-config", requireAdminAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const config = await FareConfig.getSingleton();

    if (payload.regular) {
      if (payload.regular.baseKm !== undefined) {
        const value = toNumberOrNull(payload.regular.baseKm);
        if (value === null || !isNonNegativeNumber(value)) {
          return res.status(400).json({ message: "Invalid regular.baseKm" });
        }
        config.regular.baseKm = value;
      }

      if (payload.regular.baseFare !== undefined) {
        const value = toNumberOrNull(payload.regular.baseFare);
        if (value === null || !isNonNegativeNumber(value)) {
          return res.status(400).json({ message: "Invalid regular.baseFare" });
        }
        config.regular.baseFare = value;
      }

      if (payload.regular.addlPerKm !== undefined) {
        const value = toNumberOrNull(payload.regular.addlPerKm);
        if (value === null || !isNonNegativeNumber(value)) {
          return res.status(400).json({ message: "Invalid regular.addlPerKm" });
        }
        config.regular.addlPerKm = value;
      }

      if (payload.regular.chargeMode !== undefined) {
        const value = String(payload.regular.chargeMode).trim().toLowerCase();
        if (!ALLOWED_CHARGE_MODES.includes(value)) {
          return res.status(400).json({ message: "Invalid regular.chargeMode" });
        }
        config.regular.chargeMode = value;
      }
    }

    if (payload.special) {
      if (payload.special.baseKm !== undefined) {
        const value = toNumberOrNull(payload.special.baseKm);
        if (value === null || !isNonNegativeNumber(value)) {
          return res.status(400).json({ message: "Invalid special.baseKm" });
        }
        config.special.baseKm = value;
      }

      if (payload.special.baseFare !== undefined) {
        const value = toNumberOrNull(payload.special.baseFare);
        if (value === null || !isNonNegativeNumber(value)) {
          return res.status(400).json({ message: "Invalid special.baseFare" });
        }
        config.special.baseFare = value;
      }

      if (payload.special.shortKm !== undefined) {
        const value = toNumberOrNull(payload.special.shortKm);
        if (value === null || !isNonNegativeNumber(value)) {
          return res.status(400).json({ message: "Invalid special.shortKm" });
        }
        config.special.shortKm = value;
      }

      if (payload.special.shortFare !== undefined) {
        const value = toNumberOrNull(payload.special.shortFare);
        if (value === null || !isNonNegativeNumber(value)) {
          return res.status(400).json({ message: "Invalid special.shortFare" });
        }
        config.special.shortFare = value;
      }

      if (payload.special.addlPerKm !== undefined) {
        const value = toNumberOrNull(payload.special.addlPerKm);
        if (value === null || !isNonNegativeNumber(value)) {
          return res.status(400).json({ message: "Invalid special.addlPerKm" });
        }
        config.special.addlPerKm = value;
      }

      if (payload.special.chargeMode !== undefined) {
        const value = String(payload.special.chargeMode).trim().toLowerCase();
        if (!ALLOWED_CHARGE_MODES.includes(value)) {
          return res.status(400).json({ message: "Invalid special.chargeMode" });
        }
        config.special.chargeMode = value;
      }
    }

    if (payload.discounts) {
      if (payload.discounts.enabled !== undefined) {
        if (typeof payload.discounts.enabled !== "boolean") {
          return res.status(400).json({ message: "Invalid discounts.enabled" });
        }
        config.discounts.enabled = payload.discounts.enabled;
      }

      if (payload.discounts.percent !== undefined) {
        const value = toNumberOrNull(payload.discounts.percent);
        if (
          value === null ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 100
        ) {
          return res.status(400).json({ message: "Invalid discounts.percent" });
        }
        config.discounts.percent = value;
      }

      if (payload.discounts.appliesTo !== undefined) {
        if (!Array.isArray(payload.discounts.appliesTo)) {
          return res.status(400).json({ message: "Invalid discounts.appliesTo" });
        }

        const cleaned = payload.discounts.appliesTo
          .map((x) => String(x).trim().toLowerCase())
          .filter(Boolean);

        const hasInvalid = cleaned.some(
          (x) => !ALLOWED_DISCOUNT_APPLIES_TO.includes(x)
        );

        if (hasInvalid) {
          return res.status(400).json({
            message: "Invalid discounts.appliesTo values",
          });
        }

        config.discounts.appliesTo = cleaned;
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