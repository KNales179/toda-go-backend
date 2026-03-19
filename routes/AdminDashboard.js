// AdminDashboard.js
const express = require("express");
const router = express.Router();

const Driver = require("../models/Drivers");
const DriverStatus = require("../models/DriverStatus");
const Report = require("../models/Report");
const Passenger = require("../models/Passenger");
const TricycleScheduleConfig = require("../models/TricycleScheduleConfig");
const requireAdminAuth = require("../middleware/requireAdminAuth");

const DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function normalizeWeeklyShape(weekly) {
  const out = {};

  for (const day of DAY_KEYS) {
    const val = weekly?.[day];

    // Case A: frontend sends array directly -> wrap it
    if (Array.isArray(val)) {
      out[day] = { segments: val };
      continue;
    }

    // Case B: frontend sends { segments: [...] } -> keep
    if (val && typeof val === "object") {
      out[day] = {
        segments: Array.isArray(val.segments) ? val.segments : [],
      };
      continue;
    }

    // Case C: missing -> default empty
    out[day] = { segments: [] };
  }

  return out;
}

function isValidTimeString(value) {
  return typeof value === "string" && /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function validateWeeklySegments(weekly) {
  for (const day of DAY_KEYS) {
    const segments = weekly?.[day]?.segments;

    if (!Array.isArray(segments)) {
      return `${day}.segments must be an array`;
    }

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      if (!seg || typeof seg !== "object") {
        return `${day}.segments[${i}] must be an object`;
      }

      const start = seg.start ?? seg.startTime;
      const end = seg.end ?? seg.endTime;

      if (!isValidTimeString(start)) {
        return `${day}.segments[${i}].start must be HH:MM`;
      }

      if (!isValidTimeString(end)) {
        return `${day}.segments[${i}].end must be HH:MM`;
      }

      if (start >= end) {
        return `${day}.segments[${i}] start must be earlier than end`;
      }
    }
  }

  return null;
}

// Protect all routes in this file for admin only
router.use(requireAdminAuth);

// 👉 DRIVERS for dashboard (merge Driver + DriverStatus, online on top)
router.get("/admin/dashboard/drivers", async (req, res) => {
  try {
    const [drivers, statuses] = await Promise.all([
      Driver.find({}),
      DriverStatus.find({}),
    ]);

    const statusMap = new Map(statuses.map((st) => [String(st.driverId), st]));

    const merged = drivers.map((d) => {
      const st = statusMap.get(String(d._id));
      const isOnline = !!(st && st.isOnline);

      return {
        _id: d._id,
        driverName: d.driverName,
        driverFirstName: d.driverFirstName,
        driverLastName: d.driverLastName,
        franchiseNumber: d.franchiseNumber,
        todaName: d.todaName,
        rating: d.rating,
        ratingCount: d.ratingCount,
        isOnline,
      };
    });

    // sort: online first, then name
    merged.sort((a, b) => {
      if (a.isOnline === b.isOnline) {
        return (a.driverName || "").localeCompare(b.driverName || "");
      }
      return a.isOnline ? -1 : 1;
    });

    // only top 5 for dashboard
    res.json(merged.slice(0, 5));
  } catch (err) {
    console.error("Dashboard drivers error:", err);
    res.status(500).json({ error: "Failed to load driver dashboard data" });
  }
});

router.get("/admin/dashboard/reports", async (req, res) => {
  try {
    const reports = await Report.find({}).sort({ submittedAt: -1 }).limit(10);

    const passengerIds = reports
      .map((r) => r.passengerId)
      .filter(Boolean)
      .map((id) => String(id));

    const uniquePassengerIds = [...new Set(passengerIds)];

    const passengers = uniquePassengerIds.length
      ? await Passenger.find({ _id: { $in: uniquePassengerIds } })
          .select("_id firstName lastName")
          .lean()
      : [];

    const passengerMap = new Map(
      passengers.map((p) => [String(p._id), `${p.firstName} ${p.lastName}`.trim()])
    );

    const enriched = reports.map((r) => ({
      ...r.toObject(),
      reporterName: r.passengerId
        ? passengerMap.get(String(r.passengerId)) || "Unknown"
        : "Unknown",
    }));

    res.json(enriched);
  } catch (err) {
    console.error("Dashboard reports error:", err);
    res.status(500).json({ error: "Failed to load reports" });
  }
});

// ------------------------------
// 🟨 GET TRICYCLE SCHEDULE CONFIG
// ------------------------------
router.get("/admin/tricycle-schedule", async (req, res) => {
  try {
    let doc = await TricycleScheduleConfig.findOne({ key: "global" }).lean();

    if (!doc) {
      const created = await TricycleScheduleConfig.create({ key: "global" });
      doc = created.toObject();
    }

    return res.json({ item: doc });
  } catch (err) {
    console.error("Error loading tricycle schedule:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// ------------------------------
// 🟨 UPDATE TRICYCLE SCHEDULE CONFIG
// ------------------------------
router.put("/admin/tricycle-schedule", async (req, res) => {
  try {
    const { weekly } = req.body || {};

    if (!weekly || typeof weekly !== "object" || Array.isArray(weekly)) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    const normalizedWeekly = normalizeWeeklyShape(weekly);
    const validationError = validateWeeklySegments(normalizedWeekly);

    if (validationError) {
      return res.status(400).json({
        error: "invalid_schedule",
        message: validationError,
      });
    }

    const adminId =
      req.admin?.id || req.admin?._id ? String(req.admin.id || req.admin._id) : null;

    const updated = await TricycleScheduleConfig.findOneAndUpdate(
      { key: "global" },
      {
        $set: {
          weekly: normalizedWeekly,
          updatedByAdminId: adminId,
        },
      },
      { new: true, upsert: true }
    ).lean();

    return res.json({ item: updated });
  } catch (err) {
    console.error("Error saving tricycle schedule:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;