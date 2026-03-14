const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");

const Driver = require("../models/Drivers");
const Booking = require("../models/Bookings");
const upload = require("../middleware/upload");
const requireUserAuth = require("../middleware/requireUserAuth");

const DRIVER_SELF_FIELDS = [
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
  "driverVerified",
  "isVerified",
  "plateNumber",
  "capacity",
].join(" ");

const DRIVER_RELATED_FIELDS = [
  "createdAt",
  "driverFirstName",
  "driverMiddleName",
  "driverLastName",
  "driverName",
  "driverSuffix",
  "todaName",
  "franchiseNumber",
  "sector",
  "experienceYears",
  "selfieImage",
  "driverVerified",
  "isVerified",
  "plateNumber",
  "capacity",
].join(" ");

const DRIVER_ADMIN_FIELDS = DRIVER_SELF_FIELDS;

async function canPassengerAccessDriver(passengerId, driverId) {
  const rel = await Booking.findOne({
    passengerId: String(passengerId),
    driverId: String(driverId),
    status: { $in: ["accepted", "ongoing", "completed"] },
  })
    .select("_id")
    .lean();

  return !!rel;
}

function sanitizeDriverSelf(driver) {
  return driver;
}

function sanitizeDriverRelated(driver) {
  if (!driver) return driver;

  return {
    _id: driver._id,
    createdAt: driver.createdAt || null,
    driverFirstName: driver.driverFirstName || "",
    driverMiddleName: driver.driverMiddleName || "",
    driverLastName: driver.driverLastName || "",
    driverName: driver.driverName || "",
    driverSuffix: driver.driverSuffix || "",
    todaName: driver.todaName || "",
    franchiseNumber: driver.franchiseNumber || "",
    sector: driver.sector || "",
    experienceYears: driver.experienceYears || "",
    selfieImage: driver.selfieImage || "",
    driverVerified: !!driver.driverVerified,
    isVerified: !!driver.isVerified,
    plateNumber: driver.plateNumber || "",
    capacity: driver.capacity ?? null,
  };
}

function sanitizeDriverAdmin(driver) {
  return driver;
}

router.get("/driver/:id", requireUserAuth, async (req, res) => {
  try {
    const targetId = String(req.params.id);
    const requesterId = String(req.user?.sub || "");
    const requesterRole = String(req.user?.role || "");

    let select = null;
    let mode = null;

    if (requesterRole === "driver" && requesterId === targetId) {
      select = DRIVER_SELF_FIELDS;
      mode = "self";
    } else if (requesterRole === "passenger") {
      const allowed = await canPassengerAccessDriver(requesterId, targetId);
      if (!allowed) {
        return res.status(403).json({ message: "Forbidden" });
      }
      select = DRIVER_RELATED_FIELDS;
      mode = "related";
    } else if (requesterRole === "admin") {
      select = DRIVER_ADMIN_FIELDS;
      mode = "admin";
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }

    const driver = await Driver.findById(targetId).select(select);
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    let result = driver.toObject();

    if (mode === "self") result = sanitizeDriverSelf(result);
    if (mode === "related") result = sanitizeDriverRelated(result);
    if (mode === "admin") result = sanitizeDriverAdmin(result);

    return res.status(200).json({ driver: result });
  } catch (err) {
    console.error("GET /driver/:id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/drivers", requireUserAuth, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const drivers = await Driver.find().select(DRIVER_ADMIN_FIELDS);
    return res.status(200).json(drivers);
  } catch (error) {
    console.error("GET /drivers error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/driver/:id", requireUserAuth, async (req, res) => {
  try {
    const targetId = String(req.params.id);
    const requesterId = String(req.user?.sub || "");
    const requesterRole = String(req.user?.role || "");

    if (!(requesterRole === "driver" && requesterId === targetId) && requesterRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

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

    const allowed = {};
    if (typeof driverFirstName === "string") allowed.driverFirstName = driverFirstName.trim();
    if (typeof driverMiddleName === "string") allowed.driverMiddleName = driverMiddleName.trim();
    if (typeof driverLastName === "string") allowed.driverLastName = driverLastName.trim();
    if (typeof gender === "string") allowed.gender = gender.trim();
    if (typeof driverBirthdate === "string") allowed.driverBirthdate = driverBirthdate.trim();
    if (typeof driverPhone === "string") allowed.driverPhone = driverPhone.trim();
    if (typeof homeAddress === "string") allowed.homeAddress = homeAddress.trim();
    if (typeof franchiseNumber === "string") allowed.franchiseNumber = franchiseNumber.trim();
    if (typeof sector === "string") allowed.sector = sector.trim();
    if (typeof experienceYears === "string") allowed.experienceYears = experienceYears.trim();
    if (typeof licenseId === "string") allowed.licenseId = licenseId.trim();

    const sectorEnum = ["East", "West", "North", "South", "Other"];
    if (allowed.sector && !sectorEnum.includes(allowed.sector)) {
      return res.status(400).json({ message: "Invalid sector" });
    }

    const expEnum = ["1-5 taon", "6-10 taon", "16-20 taon", "20 taon pataas"];
    if (allowed.experienceYears && !expEnum.includes(allowed.experienceYears)) {
      return res.status(400).json({ message: "Invalid experienceYears" });
    }

    if (
      "driverFirstName" in allowed ||
      "driverMiddleName" in allowed ||
      "driverLastName" in allowed
    ) {
      const current = await Driver.findById(targetId).select(
        "driverFirstName driverMiddleName driverLastName"
      );
      if (!current) return res.status(404).json({ message: "Driver not found" });

      const first =
        "driverFirstName" in allowed ? allowed.driverFirstName : current.driverFirstName;
      const mid =
        "driverMiddleName" in allowed ? allowed.driverMiddleName : current.driverMiddleName;
      const last =
        "driverLastName" in allowed ? allowed.driverLastName : current.driverLastName;

      allowed.driverName = [first, mid, last]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const driver = await Driver.findByIdAndUpdate(
      targetId,
      { $set: allowed },
      { new: true, runValidators: true }
    ).select(DRIVER_SELF_FIELDS);

    if (!driver) return res.status(404).json({ message: "Driver not found" });
    return res.status(200).json({ driver: sanitizeDriverSelf(driver.toObject()) });
  } catch (err) {
    console.error("PATCH /driver/:id error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/driver/:id/photo", requireUserAuth, upload.single("selfieImage"), async (req, res) => {
  try {
    const targetId = String(req.params.id);
    const requesterId = String(req.user?.sub || "");
    const requesterRole = String(req.user?.role || "");

    if (!(requesterRole === "driver" && requesterId === targetId) && requesterRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const filePath = req.file.path.replace(/\\/g, "/");
    const driver = await Driver.findByIdAndUpdate(
      targetId,
      { $set: { selfieImage: filePath } },
      { new: true }
    ).select(DRIVER_SELF_FIELDS);

    if (!driver) return res.status(404).json({ message: "Driver not found" });
    return res.status(200).json({ driver: sanitizeDriverSelf(driver.toObject()) });
  } catch (err) {
    console.error("POST /driver/:id/photo error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

async function requirePresidentAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ ok: false, error: "missing_token" });

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: "missing_jwt_secret" });

    const decoded = jwt.verify(token, secret);

    const driverId = decoded?.sub || decoded?.driverId || decoded?.id || decoded?._id;

    if (!driverId) return res.status(401).json({ ok: false, error: "invalid_token" });

    const me = await Driver.findById(driverId)
      .select("driverName isPresident todaPresName todaName restriction")
      .lean();

    if (!me) return res.status(401).json({ ok: false, error: "driver_not_found" });

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
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
}

router.get("/president/me", requirePresidentAuth, async (req, res) => {
  return res.json({ ok: true, president: req.president });
});

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
      todaName: { $ne: myToda },
      isPresident: { $ne: true },
    };

    if (includeUnassigned) {
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

    const rows = await Driver.find(filter)
      .select(DRIVER_LIST_SELECT)
      .sort({ createdAt: -1 })
      .lean();

    const items = rows.map(driverCard);

    return res.json({
      ok: true,
      president: req.president,
      q,
      total: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/president/members", requirePresidentAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const myToda = req.president.todaPresName;

    const filter = {
      todaName: myToda,
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

    const rows = await Driver.find(filter)
      .select(DRIVER_LIST_SELECT)
      .sort({ createdAt: -1 })
      .lean();

    const items = rows.map(driverCard);

    return res.json({
      ok: true,
      president: req.president,
      q,
      total: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.patch("/president/members/:id/add", requirePresidentAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    const myToda = req.president.todaPresName;

    if (String(targetId) === String(req.president.id)) {
      return res.status(400).json({ ok: false, error: "cannot_assign_self" });
    }

    const target = await Driver.findById(targetId)
      .select("isPresident todaName restriction")
      .lean();

    if (!target) return res.status(404).json({ ok: false, error: "driver_not_found" });

    if (target?.restriction?.isRestricted) {
      return res.status(400).json({ ok: false, error: "target_restricted" });
    }

    if (target.isPresident) {
      return res.status(403).json({ ok: false, error: "cannot_manage_president" });
    }

    const currentToda = String(target.todaName || "").trim();
    if (currentToda === myToda) {
      return res.json({ ok: true, message: "already_member" });
    }

    const updated = await Driver.findByIdAndUpdate(
      targetId,
      { $set: { todaName: myToda } },
      { new: true, runValidators: true }
    )
      .select(DRIVER_LIST_SELECT)
      .lean();

    return res.json({
      ok: true,
      message: "member_added",
      president: req.president,
      member: driverCard(updated),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.patch("/president/members/:id/kick", requirePresidentAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    const myToda = req.president.todaPresName;

    if (String(targetId) === String(req.president.id)) {
      return res.status(400).json({ ok: false, error: "cannot_kick_self" });
    }

    const target = await Driver.findById(targetId)
      .select("isPresident todaName restriction")
      .lean();

    if (!target) {
      return res.status(404).json({ ok: false, error: "driver_not_found" });
    }

    if (target.isPresident) {
      return res.status(403).json({ ok: false, error: "cannot_manage_president" });
    }

    const targetToda = String(target.todaName || "").trim();

    if (targetToda !== myToda) {
      return res.status(403).json({ ok: false, error: "not_my_member" });
    }

    const updated = await Driver.findByIdAndUpdate(
      targetId,
      { $set: { todaName: "Unassigned" } },
      { new: true, runValidators: true }
    )
      .select(DRIVER_LIST_SELECT)
      .lean();

    return res.json({
      ok: true,
      message: "member_kicked",
      president: req.president,
      member: driverCard(updated),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;