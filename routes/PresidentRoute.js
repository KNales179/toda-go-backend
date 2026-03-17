const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Driver = require("../models/Drivers");

function escapeRegex(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  "profileID",
  "experienceYears",
  "gender",
  "driverBirthdate",
  "licenseId",
  "isLucenaVoter",
  "votingLocation",
  "plateNumber",
  "capacity",
  "createdAt",
  "isVerified",
].join(" ");

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

async function requirePresidentAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ ok: false, error: "missing_token" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(500).json({ ok: false, error: "missing_jwt_secret" });
    }

    const decoded = jwt.verify(token, secret);
    const driverId = decoded?.sub || decoded?.driverId || decoded?.id || decoded?._id;

    if (!driverId) {
      return res.status(401).json({ ok: false, error: "invalid_token" });
    }

    const me = await Driver.findById(driverId)
      .select("driverName isPresident todaPresName todaName restriction")
      .lean();

    if (!me) {
      return res.status(401).json({ ok: false, error: "driver_not_found" });
    }

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

router.get("/president/drivers", requirePresidentAuth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const myToda = req.president.todaPresName;

    const filter = {
      todaName: { $ne: myToda },
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
        { todaName: rx },
        { sector: rx },
      ];
    }

    const rows = await Driver.find(filter)
      .select(DRIVER_LIST_SELECT)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      president: req.president,
      q,
      total: rows.length,
      items: rows.map(driverCard),
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

    return res.json({
      ok: true,
      president: req.president,
      q,
      total: rows.length,
      items: rows.map(driverCard),
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/president/driver/:id", requirePresidentAuth, async (req, res) => {
  try {
    const targetId = String(req.params.id || "").trim();
    if (!targetId) {
      return res.status(400).json({ ok: false, error: "missing_driver_id" });
    }

    const driver = await Driver.findById(targetId).select(DRIVER_LIST_SELECT).lean();

    if (!driver) {
      return res.status(404).json({ ok: false, error: "driver_not_found" });
    }

    return res.json({ ok: true, driver });
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

    if (!target) {
      return res.status(404).json({ ok: false, error: "driver_not_found" });
    }

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