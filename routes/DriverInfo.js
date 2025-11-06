// routes/DriverInfo.js
const express = require("express");
const router = express.Router();

const Driver = require("../models/Drivers");
const upload = require("../middleware/upload"); // uses uploads/ and filters jpg/png

// GET /api/driver/:id ➜ fetch driver's profile (now includes licenseId)
router.get("/driver/:id", async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id).select(
      [
        "profileID",
        "isLucenaVoter",
        "votingLocation",
        "createdAt",
        "driverFirstName",
        "driverMiddleName",
        "driverLastName",
        "driverName",
        "driverSuffix",
        "email",
        "driverPhone",
        "todaName",
        "franchiseNumber",
        "sector",
        "experienceYears",
        "gender",
        "driverBirthdate",
        "homeAddress",
        "selfieImage",
        "licenseId", // ✅ expose new field
      ].join(" ")
    );

    if (!driver) return res.status(404).json({ message: "Driver not found" });
    res.status(200).json({ driver });
  } catch (err) {
    console.error("❌ Failed to fetch driver info:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/drivers ➜ list (kept)
router.get("/drivers", async (_req, res) => {
  try {
    const drivers = await Driver.find().select(
      [
        "profileID",
        "isLucenaVoter",
        "votingLocation",
        "createdAt",
        "driverFirstName",
        "driverMiddleName",
        "driverLastName",
        "driverName",
        "driverSuffix",
        "email",
        "driverPhone",
        "todaName",
        "franchiseNumber",
        "sector",
        "experienceYears",
        "gender",
        "driverBirthdate",
        "homeAddress",
        "selfieImage",
        "licenseId", // ✅ include in list too
      ].join(" ")
    );
    res.status(200).json(drivers);
  } catch (error) {
    console.error("❌ Failed to fetch drivers:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// PATCH /api/driver/:id ➜ update editable fields
router.patch("/driver/:id", async (req, res) => {
  try {
    const {
      driverFirstName,
      driverMiddleName,
      driverLastName,
      gender,
      driverBirthdate,
      driverPhone,
      homeAddress,
      todaName,
      franchiseNumber,
      sector,
      experienceYears,
      licenseId,
    } = req.body;

    // whitelist only allowed keys
    const allowed = {};
    if (typeof driverFirstName === "string") allowed.driverFirstName = driverFirstName.trim();
    if (typeof driverMiddleName === "string") allowed.driverMiddleName = driverMiddleName.trim();
    if (typeof driverLastName === "string") allowed.driverLastName = driverLastName.trim();
    if (typeof gender === "string") allowed.gender = gender.trim();
    if (typeof driverBirthdate === "string") allowed.driverBirthdate = driverBirthdate.trim(); // expect YYYY-MM-DD
    if (typeof driverPhone === "string") allowed.driverPhone = driverPhone.trim();
    if (typeof homeAddress === "string") allowed.homeAddress = homeAddress.trim();
    if (typeof todaName === "string") allowed.todaName = todaName.trim();
    if (typeof franchiseNumber === "string") allowed.franchiseNumber = franchiseNumber.trim();
    if (typeof sector === "string") allowed.sector = sector.trim();
    if (typeof experienceYears === "string") allowed.experienceYears = experienceYears.trim();
    if (typeof licenseId === "string") allowed.licenseId = licenseId.trim();

    // enum guards (only if provided)
    const sectorEnum = ["East", "West", "North", "South", "Other"];
    if (allowed.sector && !sectorEnum.includes(allowed.sector)) {
      return res.status(400).json({ message: "Invalid sector" });
    }

    const expEnum = ["1-5 taon", "6-10 taon", "16-20 taon", "20 taon pataas"];
    if (allowed.experienceYears && !expEnum.includes(allowed.experienceYears)) {
      return res.status(400).json({ message: "Invalid experienceYears" });
    }

    // if name parts present, refresh driverName for convenience (First [Middle] Last)
    if (
      "driverFirstName" in allowed ||
      "driverMiddleName" in allowed ||
      "driverLastName" in allowed
    ) {
      // fetch existing values to compose
      const current = await Driver.findById(req.params.id).select(
        "driverFirstName driverMiddleName driverLastName"
      );
      if (!current) return res.status(404).json({ message: "Driver not found" });
      const first = "driverFirstName" in allowed ? allowed.driverFirstName : current.driverFirstName;
      const mid =
        "driverMiddleName" in allowed ? allowed.driverMiddleName : current.driverMiddleName;
      const last = "driverLastName" in allowed ? allowed.driverLastName : current.driverLastName;
      allowed.driverName = [first, mid, last].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    }

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { $set: allowed },
      { new: true, runValidators: true }
    ).select(
      [
        "profileID",
        "isLucenaVoter",
        "votingLocation",
        "createdAt",
        "driverFirstName",
        "driverMiddleName",
        "driverLastName",
        "driverName",
        "driverSuffix",
        "email",
        "driverPhone",
        "todaName",
        "franchiseNumber",
        "sector",
        "experienceYears",
        "gender",
        "driverBirthdate",
        "homeAddress",
        "selfieImage",
        "licenseId",
      ].join(" ")
    );

    if (!driver) return res.status(404).json({ message: "Driver not found" });
    res.status(200).json({ driver });
  } catch (err) {
    console.error("❌ Failed to update driver:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// POST /api/driver/:id/photo ➜ upload selfie (field: selfieImage)
router.post( "/driver/:id/photo",
  upload.single("selfieImage"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const filePath = req.file.path.replace(/\\/g, "/"); // normalize on Windows too
      const driver = await Driver.findByIdAndUpdate(
        req.params.id,
        { $set: { selfieImage: filePath } },
        { new: true }
      ).select(
        [
          "profileID",
          "isLucenaVoter",
          "votingLocation",
          "createdAt",
          "driverFirstName",
          "driverMiddleName",
          "driverLastName",
          "driverName",
          "driverSuffix",
          "email",
          "driverPhone",
          "todaName",
          "franchiseNumber",
          "sector",
          "experienceYears",
          "gender",
          "driverBirthdate",
          "homeAddress",
          "selfieImage",
          "licenseId",
        ].join(" ")
      );

      if (!driver) return res.status(404).json({ message: "Driver not found" });
      res.status(200).json({ driver });
    } catch (err) {
      console.error("❌ Driver photo upload error:", err);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
