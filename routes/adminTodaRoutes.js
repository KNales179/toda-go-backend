// routes/adminTodaRoutes.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Toda = require("../models/Toda");
const requireAdminAuth = require("../middleware/requireAdminAuth");

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

// ✅ GET all TODAs (admin list)
router.get("/todas", requireAdminAuth, async (req, res) => {
  try {
    const todas = await Toda.find().sort({ name: 1 });
    res.json(todas);
  } catch (err) {
    console.error("[TODA] GET /todas error:", err);
    res.status(500).json({ message: "Failed to load TODA locations." });
  }
});

router.post("/todas", requireAdminAuth, async (req, res) => {
  try {
    const {
      id,
      _id,
      name,
      latitude,
      longitude,
      street,
      barangay,
      city,
      notes,
      servedDestinations,
      finalDestinations,
      radiusMeters,
      isActive,
    } = req.body;

    const todaId = _id || id || null;

    const normalizedName = String(name || "").trim();
    const normalizedLatitude = toNumberOrNull(latitude);
    const normalizedLongitude = toNumberOrNull(longitude);

    if (!normalizedName || normalizedLatitude === null || normalizedLongitude === null) {
      return res.status(400).json({
        message: "Name, latitude, and longitude are required.",
      });
    }

    if (normalizedLatitude < -90 || normalizedLatitude > 90) {
      return res.status(400).json({ message: "Invalid latitude." });
    }

    if (normalizedLongitude < -180 || normalizedLongitude > 180) {
      return res.status(400).json({ message: "Invalid longitude." });
    }

    let normalizedRadius = null;
    if (radiusMeters !== undefined) {
      normalizedRadius = toNumberOrNull(radiusMeters);
      if (normalizedRadius === null || normalizedRadius < 0) {
        return res.status(400).json({ message: "Invalid radiusMeters." });
      }
    }

    const normalizedServedDestinations = Array.isArray(servedDestinations)
      ? servedDestinations
      : [];
    const normalizedFinalDestinations = Array.isArray(finalDestinations)
      ? finalDestinations
      : [];

    // 🔁 UPDATE
    if (todaId) {
      if (!mongoose.Types.ObjectId.isValid(todaId)) {
        return res.status(400).json({ message: "Invalid TODA id." });
      }

      const existing = await Toda.findById(todaId);
      if (!existing) {
        return res.status(404).json({ message: "TODA not found." });
      }

      existing.name = normalizedName;
      existing.latitude = normalizedLatitude;
      existing.longitude = normalizedLongitude;

      existing.street = street !== undefined ? street : existing.street;
      existing.barangay = barangay !== undefined ? barangay : existing.barangay;
      existing.city = city !== undefined ? city : existing.city;
      existing.notes = notes !== undefined ? notes : existing.notes;

      existing.servedDestinations = normalizedServedDestinations;
      existing.finalDestinations = normalizedFinalDestinations;

      if (normalizedRadius !== null) {
        existing.radiusMeters = normalizedRadius;
      }

      if (typeof isActive === "boolean") {
        existing.isActive = isActive;
      }

      const updated = await existing.save();
      return res.json(updated);
    }

    // ➕ CREATE
    const toda = new Toda({
      name: normalizedName,
      latitude: normalizedLatitude,
      longitude: normalizedLongitude,
      street: street || "",
      barangay: barangay || "",
      city: city || "",
      notes: notes || "",
      servedDestinations: normalizedServedDestinations,
      finalDestinations: normalizedFinalDestinations,
      radiusMeters: normalizedRadius !== null ? normalizedRadius : 0,
      isActive: typeof isActive === "boolean" ? isActive : true,
    });

    const saved = await toda.save();
    return res.status(201).json(saved);
  } catch (err) {
    console.error("[TODA] POST /todas (create/update) error:", err);
    res.status(500).json({ message: "Failed to save TODA." });
  }
});

// ❌ DELETE TODA
router.delete("/todas/:id", requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid TODA id." });
    }

    const toda = await Toda.findById(id);
    if (!toda) {
      return res.status(404).json({ message: "TODA not found." });
    }

    await toda.deleteOne();
    res.json({ ok: true, message: "TODA deleted." });
  } catch (err) {
    console.error("[TODA] DELETE /todas/:id error:", err);
    res.status(500).json({ message: "Failed to delete TODA." });
  }
});

// (Optional) public endpoint for passenger/driver maps
router.get("/todas-public", async (req, res) => {
  try {
    const todas = await Toda.find({ isActive: true }).select(
      "name latitude longitude street barangay city servedDestinations finalDestinations radiusMeters"
    );
    res.json(todas);
  } catch (err) {
    console.error("[TODA] GET /todas-public error:", err);
    res.status(500).json({ message: "Failed to load TODA data." });
  }
});

module.exports = router;