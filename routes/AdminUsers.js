const express = require("express");
const router = express.Router();

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
router.get("/passengers", async (req, res) => {
  try {
    // 1) Read from DB (latest first)
    const rows = await Passenger.find({})
      .sort({ createdAt: -1 }) // works if schema has { timestamps: true }
      .lean();

    console.log(
      "📥 RAW FROM DB (first 5):",
      rows.slice(0, 5).map((p) => ({
        id: p._id,
        email: p.email,
        isVerified: p.isVerified,
      }))
    );

    // 2) Normalize for frontend
    const items = rows.map((p) => {
      const isVerified = !!p.isVerified; // force boolean

      return {
        id: String(p._id),
        name: fullName(p.firstName, p.middleName, p.lastName, p.suffix),
        email: p.email || "",
        contact: p.phone || p.contact || "",
        gender: p.gender || "",
        birthday: p.birthday || "",
        address: p.address || p.homeAddress || "",
        emergencyContactName: p.eContactName || "",
        emergencyContactPhone: p.eContactPhone || "",
        isVerified,
        status: isVerified ? "Verified" : "Not Verified",
        raw: p, // for modal view
      };
    });

    console.log(
      "📦 NORMALIZED PASSENGERS (first 5):",
      items.slice(0, 5).map((p) => ({
        id: p.id,
        email: p.email,
        isVerified: p.isVerified,
        status: p.status,
      }))
    );

    // 3) Single response shape
    return res.json({ items, total: items.length });
  } catch (error) {
    console.error("❌ FAILED TO LOAD PASSENGERS:", error);
    return res.status(500).json({ error: "server_error" });
  }
});

// ------------------------------
// 🟩 GET ALL DRIVERS
// ------------------------------
router.get("/drivers", async (req, res) => {
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

module.exports = router;
