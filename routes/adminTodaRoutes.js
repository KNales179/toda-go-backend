// routes/adminTodaRoutes.js
const express = require("express");
const router = express.Router();
const Toda = require("../models/Toda");

// ✅ GET all TODAs (admin list)
router.get("/todas", async (req, res) => {
  try {
    const todas = await Toda.find().sort({ name: 1 });
    res.json(todas);
  } catch (err) {
    console.error("[TODA] GET /todas error:", err);
    res.status(500).json({ message: "Failed to load TODA locations." });
  }
});

/**
 * ✅ ADD + EDIT in ONE route
 * POST /api/admin/todas
 * - if body contains id / _id → update
 * - else → create new
 */
router.post("/todas", async (req, res) => {
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
      isActive,
    } = req.body;

    const todaId = _id || id || null;

    if (!name || latitude == null || longitude == null) {
      return res.status(400).json({
        message: "Name, latitude, and longitude are required.",
      });
    }

    // 🔁 If there is an id → UPDATE
    if (todaId) {
      const existing = await Toda.findById(todaId);
      if (!existing) {
        return res.status(404).json({ message: "TODA not found." });
      }

      if (name !== undefined) existing.name = name;
      if (latitude !== undefined) existing.latitude = latitude;
      if (longitude !== undefined) existing.longitude = longitude;
      if (street !== undefined) existing.street = street;
      if (barangay !== undefined) existing.barangay = barangay;
      if (city !== undefined) existing.city = city;
      if (notes !== undefined) existing.notes = notes;
      if (Array.isArray(servedDestinations)) {
        existing.servedDestinations = servedDestinations;
      }
      if (typeof isActive === "boolean") {
        existing.isActive = isActive;
      }

      const updated = await existing.save();
      return res.json(updated); // 200 OK
    }

    // ➕ No id → CREATE new TODA
    const toda = new Toda({
      name,
      latitude,
      longitude,
      street,
      barangay,
      city,
      notes,
      servedDestinations: Array.isArray(servedDestinations)
        ? servedDestinations
        : [],
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
router.delete("/todas/:id", async (req, res) => {
  try {
    const { id } = req.params;
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
      "name latitude longitude street barangay city servedDestinations"
    );
    res.json(todas);
  } catch (err) {
    console.error("[TODA] GET /todas-public error:", err);
    res.status(500).json({ message: "Failed to load TODA data." });
  }
});

module.exports = router;
