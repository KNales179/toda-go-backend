// routes/fareCompute.js
const express = require("express");
const router = express.Router();
const FareConfig = require("../models/FareConfig");
const Passenger = require("../models/Passenger");
const requireUserAuth = require("../middleware/requireUserAuth");

router.post("/fare/compute", requireUserAuth, async (req, res) => {
  try {
    const { distanceKm, bookingType = "CLASSIC", partySize = 1 } = req.body;

    if (!distanceKm || distanceKm <= 0) {
      return res.status(400).json({ message: "Invalid distance" });
    }

    // 1. Load fare config
    const config = await FareConfig.getSingleton();

    const normalizedType = ["CLASSIC", "GROUP", "SOLO"].includes(
      String(bookingType).toUpperCase()
    )
      ? String(bookingType).toUpperCase()
      : "CLASSIC";

    const isSolo = normalizedType === "SOLO";

    const fareRules = isSolo ? config.special : config.regular;

    let fare = 0;
    const resolvedDistanceKm = Number(distanceKm);

    if (isSolo && resolvedDistanceKm <= Number(fareRules.shortKm || 0)) {
      fare = Number(fareRules.shortFare || 0);
    } else {
      const extraKm = Math.max(
        0,
        resolvedDistanceKm - Number(fareRules.baseKm || 0)
      );
      const additionalUnits = Math.ceil(extraKm);

      fare =
        Number(fareRules.baseFare || 0) +
        additionalUnits * Number(fareRules.addlPerKm || 0);
    }

    // 3. Charge mode
    let size = Number(partySize);

    if (normalizedType === "GROUP") {
      if (!Number.isFinite(size) || size < 1) size = 1;
      if (size > 5) size = 5;
    } else {
      size = 1;
    }

    if (fareRules.chargeMode === "per_passenger") {
      fare *= size;
    }

    // 4. Get passenger for discount
    const passengerId = req.user?.sub || req.user?.id;
    const passenger = passengerId ? await Passenger.findById(passengerId) : null;

    let discountApplied = 0;

    if (
      config.discounts.enabled &&
      passenger?.discount &&
      passenger?.discountVerification?.status === "approved"
    ) {
      const normalizeDiscountType = (value) => {
        const v = String(value || "").trim().toLowerCase();

        if (v === "senior citizen" || v === "senior") return "senior";
        if (v === "pwd") return "pwd";
        if (v === "student") return "student";

        return "";
      };

      const normalizedDiscountType = normalizeDiscountType(
        passenger.discountType || passenger.discountVerification?.type
      );

      const allowedTypes = config.discounts.appliesTo.map((x) =>
        String(x).trim().toLowerCase()
      );

      if (allowedTypes.includes(normalizedDiscountType)) {
        discountApplied = config.discounts.percent;
        fare = fare - (fare * discountApplied) / 100;
      }
    }

    // 5. Final result
    return res.json({
      fare: Math.round(fare),
      breakdown: {
        baseFare: Number(fareRules.baseFare || 0),
        addlPerKm: Number(fareRules.addlPerKm || 0),
        distanceKm: resolvedDistanceKm,
        discountApplied,
        bookingType: normalizedType,
        chargeMode: fareRules.chargeMode || "",
        partySize: size,
      },
    });

  } catch (err) {
    console.error("Fare compute error:", err);
    res.status(500).json({ message: "Failed to compute fare" });
  }
});

module.exports = router;