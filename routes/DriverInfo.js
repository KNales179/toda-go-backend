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
      "todaName",
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


async function requirePresidentAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: "missing_token" });

    const secret = process.env.JWT_SECRET; // ✅ use the same secret as your driver login
    if (!secret) return res.status(500).json({ ok: false, error: "missing_jwt_secret" });

    const decoded = jwt.verify(token, secret);

    // Adjust if your token payload uses a different key
    const driverId = decoded?.sub || decoded?.driverId || decoded?.id || decoded?._id;
    if (!driverId) return res.status(401).json({ ok: false, error: "invalid_token" });

    const me = await Driver.findById(driverId)
      .select("driverName isPresident todaPresName todaName restriction")
      .lean();

    if (!me) return res.status(401).json({ ok: false, error: "driver_not_found" });

    // blocked presidents are still blocked
    if (me?.restriction?.isRestricted) {
      return res.status(403).json({ ok: false, error: "restricted" });
    }

    const presToda = String(me.todaPresName || "").trim();
    if (!me.isPresident || !presToda) {
      return res.status(403).json({ ok: false, error: "not_president" });
    }

    req.president = {
      id: String(me._id),
      name: me.driverName || "President",
      todaPresName: presToda,
      todaName: String(me.todaName || "").trim(),
    };

    next();
  } catch (err) {
    console.error("❌ requirePresidentAuth error:", err?.message || err);
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
}


// ------------------------------
// 👑 PRESIDENT: WHO AM I
// GET /api/president/me
// ------------------------------
router.get("/president/me", requirePresidentAuth, async (req, res) => {
  return res.json({ ok: true, president: req.president });
});

// ------------------------------
// 🔎 shared helpers
// ------------------------------
function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function driverCard(d) {
  return {
    id: String(d._id),
    name: d.driverName || "Driver",
    franchiseNumber: d.franchiseNumber || "",
    todaName: d.todaName || "",
    sector: d.sector || "",
    email: d.email || "",
    contact: d.driverPhone || "",
    selfieImage: d.selfieImage || "",
    driverVerified: !!d.driverVerified,
    isRestricted: !!d?.restriction?.isRestricted,
    isPresident: !!d.isPresident,
    todaPresName: d.todaPresName || "",
  };
}

const DRIVER_LIST_SELECT = [
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
  "driverVerified",
  "restriction",
  "isPresident",
  "todaPresName",
].join(" ");


router.get("/president/drivers", requirePresidentAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const includeUnassigned = String(req.query.includeUnassigned || "").trim() === "1";
    const myToda = req.president.todaPresName;

    const filter = {
      // candidates: not already in my TODA
      todaName: { $ne: myToda },
      // don't allow managing presidents (keeps power clean)
      isPresident: { $ne: true },
    };

    // optionally restrict to unassigned only (if you want later)
    if (includeUnassigned) {
      // leave as-is; include unassigned + other TODAs
      // if you want ONLY unassigned, replace with:
      // filter.todaName = { $in: ["", null] };
    }

    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
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

    const rows = await Driver.find(filter).select(DRIVER_LIST_SELECT).sort({ createdAt: -1 }).lean();
    const items = rows.map(driverCard);

    return res.json({
      ok: true,
      president: req.president,
      q,
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("❌ president drivers list error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ------------------------------
// 👑 PRESIDENT: LIST MEMBERS (in my TODA)
// GET /api/president/members?q=...
// ------------------------------
router.get("/president/members", requirePresidentAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const myToda = req.president.todaPresName;

    const filter = {
      todaName: myToda,
      // still exclude presidents from member list unless you want them shown
      isPresident: { $ne: true },
    };

    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { driverName: rx },
        { driverFirstName: rx },
        { driverMiddleName: rx },
        { driverLastName: rx },
        { franchiseNumber: rx },
        { email: rx },
        { driverPhone: rx },
        { sector: rx },
      ];
    }

    const rows = await Driver.find(filter).select(DRIVER_LIST_SELECT).sort({ createdAt: -1 }).lean();
    const items = rows.map(driverCard);

    return res.json({
      ok: true,
      president: req.president,
      q,
      total: items.length,
      items,
    });
  } catch (err) {
    console.error("❌ president members list error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ------------------------------
// 👑 PRESIDENT: ADD MEMBER (assign to my TODA)
// PATCH /api/president/members/:id/add
// ------------------------------
router.patch("/president/members/:id/add", requirePresidentAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    const myToda = req.president.todaPresName;

    // prevent adding self
    if (String(targetId) === String(req.president.id)) {
      return res.status(400).json({ ok: false, error: "cannot_assign_self" });
    }

    const target = await Driver.findById(targetId).select("isPresident todaName restriction").lean();
    if (!target) return res.status(404).json({ ok: false, error: "driver_not_found" });

    if (target?.restriction?.isRestricted) {
      return res.status(400).json({ ok: false, error: "target_restricted" });
    }

    if (target.isPresident) {
      return res.status(403).json({ ok: false, error: "cannot_manage_president" });
    }

    // if already member
    if (String(target.todaName || "").trim() === myToda) {
      return res.json({ ok: true, message: "already_member" });
    }

    const updated = await Driver.findByIdAndUpdate(
      targetId,
      { $set: { todaName: myToda } },
      { new: true, runValidators: true }
    ).select(DRIVER_LIST_SELECT).lean();

    return res.json({
      ok: true,
      message: "member_added",
      president: req.president,
      member: driverCard(updated),
    });
  } catch (err) {
    console.error("❌ add member error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ------------------------------
// 👑 PRESIDENT: KICK MEMBER (remove from my TODA)
// PATCH /api/president/members/:id/kick
// ------------------------------
router.patch("/president/members/:id/kick", requirePresidentAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    const myToda = req.president.todaPresName;

    // prevent kicking self
    if (String(targetId) === String(req.president.id)) {
      return res.status(400).json({ ok: false, error: "cannot_kick_self" });
    }

    const target = await Driver.findById(targetId).select("isPresident todaName").lean();
    if (!target) return res.status(404).json({ ok: false, error: "driver_not_found" });

    if (target.isPresident) {
      return res.status(403).json({ ok: false, error: "cannot_manage_president" });
    }

    // must be in my TODA to kick
    if (String(target.todaName || "").trim() !== myToda) {
      return res.status(403).json({ ok: false, error: "not_my_member" });
    }

    const updated = await Driver.findByIdAndUpdate(
      targetId,
      { $unset: { todaName: 1 } },
      { new: true, runValidators: true }
    ).select(DRIVER_LIST_SELECT).lean();

    return res.json({
      ok: true,
      message: "member_kicked",
      president: req.president,
      member: driverCard(updated),
    });
  } catch (err) {
    console.error("❌ kick member error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});


module.exports = router;
