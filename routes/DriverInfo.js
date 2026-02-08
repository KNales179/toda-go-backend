// routes/DriverInfo.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");

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
        "licenseId",
        "restriction",
        "isPresident",
        "todaPresName",
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


// ------------------------------
// 👑 PRESIDENT AUTH (driverToken)
// ------------------------------
async function requirePresidentAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "missing_token" });

    const secret = process.env.JWT_SECRET || process.env.SECRET || "secret"; // adjust to your env key
    const decoded = jwt.verify(token, secret);

    // decoded should contain driverId (depends on how you sign it)
    const driverId = decoded?.driverId || decoded?.id || decoded?._id;
    if (!driverId) return res.status(401).json({ ok: false, error: "invalid_token" });

    const me = await Driver.findById(driverId).select("isPresident todaPresName driverName").lean();
    if (!me) return res.status(401).json({ ok: false, error: "driver_not_found" });

    if (!me.isPresident || !String(me.todaPresName || "").trim()) {
      return res.status(403).json({ ok: false, error: "not_president" });
    }

    req.president = {
      id: String(me._id),
      driverName: me.driverName || "President",
      todaPresName: String(me.todaPresName || "").trim(),
    };

    next();
  } catch (err) {
    console.error("❌ requirePresidentAuth error:", err?.message || err);
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
}

router.get("/president/drivers", requirePresidentAuth, async (req, res) => {
  try {
    const mode = String(req.query.mode || "drivers").toLowerCase();
    const q = String(req.query.q || "").trim();

    const myToda = req.president.todaPresName;

    // Base filter depending on mode
    let filter = {};
    if (mode === "members") {
      filter = { todaName: myToda };
    } else {
      // "drivers": show everyone NOT in my TODA
      filter = { todaName: { $ne: myToda } };
    }

    // optional search
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { driverName: rx },
        { driverFirstName: rx },
        { driverMiddleName: rx },
        { driverLastName: rx },
        { franchiseNumber: rx },
        { email: rx },
        { driverPhone: rx },
        { todaName: rx },
        { sector: rx },
      ];
    }

    const rows = await Driver.find(filter)
      .select(
        [
          "driverName",
          "driverFirstName",
          "driverMiddleName",
          "driverLastName",
          "driverSuffix",
          "email",
          "driverPhone",
          "todaName",
          "franchiseNumber",
          "sector",
          "selfieImage",
          "isPresident",
          "todaPresName",
          "driverVerified",
          "isVerified",
          "restriction",
        ].join(" ")
      )
      .sort({ createdAt: -1 })
      .lean();

    const items = rows.map((d) => ({
      id: String(d._id),
      name: d.driverName || "Driver",
      franchiseNumber: d.franchiseNumber || "",
      todaName: d.todaName || "",
      sector: d.sector || "",
      email: d.email || "",
      contact: d.driverPhone || "",
      selfieImage: d.selfieImage || "",

      // for UI badges later
      isPresident: !!d.isPresident,
      todaPresName: d.todaPresName || "",

      // optional flags
      driverVerified: !!d.driverVerified,
      isVerified: !!d.isVerified,
      isRestricted: !!d?.restriction?.isRestricted,
    }));

    return res.json({
      ok: true,
      president: req.president,
      mode,
      q,
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("❌ president drivers list error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;
