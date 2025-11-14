// routes/AdminUsers.js (or wherever this lives)
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const Passenger = require("../models/Passenger");
const Driver = require("../models/Drivers");

// ------------------------------
// 🔧 HELPERS
// ------------------------------
function fullName(first, middle, last, suffix = "") {
  return [first, middle, last, suffix]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------
// 🟩 GET ALL PASSENGERS (ADMIN)
// ------------------------------
router.get("/admin/passengers", async (req, res) => {
    try {
        const rows = await Passenger.find({}).sort({ createdAt: -1 }).lean();

        console.log(
        "📥 RAW FROM DB (first 3):",
        rows.slice(0, 3).map((p) => ({
            id: p._id,
            email: p.email,
            isVerified: p.isVerified,
        }))
        );

        const items = rows.map((p) => {
        const isVerified = !!p.isVerified;

        return {
            id: String(p._id),
            name: fullName(p.firstName, p.middleName, p.lastName, p.suffix),
            email: p.email || "",
            contact: p.phone || p.contact || "",
            isVerified,
            status: isVerified ? "verified" : "not verified",
            raw: p,
        };
        });

        console.log(
        "📦 NORMALIZED PASSENGERS (first 3):",
        items.slice(0, 3).map((p) => ({
            id: p.id,
            email: p.email,
            isVerified: p.isVerified,
            status: p.status,
        }))
        );

        return res.json({ items, total: items.length });
    } catch (err) {
        console.error("❌ FAILED TO LOAD PASSENGERS:", err);
        return res.status(500).json({ error: "server_error" });
    }
});


// ------------------------------
// 🟩 GET ALL DRIVERS (unchanged)
// ------------------------------
router.get("/admin/drivers", async (req, res) => {
  try {
    const rows = await Driver.find({}).sort({ createdAt: -1 }).lean();

    const items = rows.map((d) => ({
      id: String(d._id),
      name:
        d.driverName ||
        fullName(
          d.driverFirstName,
          d.driverMiddleName,
          d.driverLastName,
          d.driverSuffix
        ),
      email: d.email || "",
      driverVerified: !!d.driverVerified,       
      isVerified: !!d.isVerified,
      contact: d.driverPhone || "",
      gender: d.gender || "",
      birthday: d.driverBirthdate || "",
      address: d.homeAddress || "",
      profileID: d.profileID,
      franchiseNumber: d.franchiseNumber,
      todaName: d.todaName,
      sector: d.sector,
      experience: d.experienceYears,
      capacity: d.capacity,
      rating: d.rating,
      ratingCount: d.ratingCount,
      payment: {
        gcashNumber: d.gcashNumber,
        gcashQRUrl: d.gcashQRUrl,
      },
      verification: {
        isVerified: d.isVerified,
        isLucenaVoter: d.isLucenaVoter,
        votingLocation: d.votingLocation,
      },
      documents: {
        votersIDImage: d.votersIDImage,
        driversLicenseImage: d.driversLicenseImage,
        orcrImage: d.orcrImage,
        selfieImage: d.selfieImage,
      },
      raw: d,
    }));

    return res.json({ items, total: items.length });
  } catch (err) {
    console.error("Error loading drivers:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// ------------------------------
// 🗑 DELETE DRIVER (ADMIN)
// ------------------------------
router.delete("/admin/drivers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "missing_id" });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }

    const deleted = await Driver.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error deleting driver:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// ------------------------------
// ✅ PATCH /api/drivers/:id/verify
// ------------------------------
router.patch("/admin/drivers/:id/verify", async (req, res) => {
  try {
    const { id } = req.params;
    const { driverVerified = true } = req.body;

    const updated = await Driver.findByIdAndUpdate(
      id,
      { $set: { driverVerified: !!driverVerified } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, error: "driver_not_found" });
    }

    return res.json({
      ok: true,
      driver: {
        id: String(updated._id),
        driverVerified: !!updated.driverVerified,
      },
    });
  } catch (err) {
    console.error("❌ verify driver error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});


module.exports = router;
