// routes/adminstats.js
const express = require("express");
const router = express.Router();

const RideHistory = require("../models/RideHistory");
const Passenger = require("../models/Passenger");
const Driver = require("../models/Drivers");

// --- Helper: Build monthly aggregation pipeline ---
function monthlyAggPipeline() {
  const now = new Date();
  const currentYear = now.getFullYear();

  const yearStart = new Date(currentYear, 0, 1);         // Jan 1
  const nextYearStart = new Date(currentYear + 1, 0, 1); // Jan 1 next year

  return [
    {
      // Always try to convert createdAt (string or Date) to a Date,
      // fall back to ObjectId timestamp if createdAt is missing.
      $addFields: {
        eventDate: {
          $ifNull: [
            { $toDate: "$createdAt" },
            { $toDate: "$_id" }
          ]
        }
      }
    },
    {
      $match: {
        eventDate: {
          $gte: yearStart,
          $lt: nextYearStart,
        },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$eventDate" },
          month: { $month: "$eventDate" },
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ];
}


// ---------- MONTHLY STATS ----------
router.get("/admin/stats/monthly", async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const janStart = new Date(year, 0, 1);  // Jan 1
    const febStart = new Date(year, 1, 1);  // Feb 1

    // 🔍 1) How many RideHistory docs exist in total?
    const totalTripsAll = await RideHistory.countDocuments({});

    // 🔍 2) How many of those are in January (by createdAt)?
    const janTripsCount = await RideHistory.countDocuments({
      createdAt: { $gte: janStart, $lt: febStart },
    });
    // 👉 3) Run the existing aggregation (what the dashboard uses)
    const tripsAgg = await RideHistory.aggregate(monthlyAggPipeline());
    const usersAgg = await Passenger.aggregate(monthlyAggPipeline());
    const driversAgg = await Driver.aggregate(monthlyAggPipeline());

    // 🔍 4) Sum what the aggregation sees (all months combined)
    const totalTripsAgg = tripsAgg.reduce(
      (sum, row) => sum + (row.count || 0),
      0
    );

    const map = new Map();

    const mergeAgg = (agg, fieldName) => {
      agg.forEach((row) => {
        const y = row._id.year;
        const m = row._id.month;
        const key = `${y}-${m}`;

        let base = map.get(key);
        if (!base) {
          base = {
            year: y,
            monthIndex: m - 1,
            trips: 0,
            users: 0,
            drivers: 0,
          };
        }
        base[fieldName] = row.count;
        map.set(key, base);
      });
    };

    mergeAgg(tripsAgg, "trips");
    mergeAgg(usersAgg, "users");
    mergeAgg(driversAgg, "drivers");

    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const result = Array.from(map.values())
      .sort((a, b) =>
        a.year === b.year
          ? a.monthIndex - b.monthIndex
          : a.year - b.year
      )
      .map((row) => ({
        month: monthNames[row.monthIndex],
        trips: row.trips || 0,
        users: row.users || 0,
        drivers: row.drivers || 0,
      }));

    res.json(result);
  } catch (err) {
    console.error("Monthly stats error:", err);
    res.status(500).json({ error: "Failed to load monthly stats" });
  }
});

// ---------- WEEKLY STATS (current month, per week) ----------
router.get("/admin/stats/weekly", async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const monthIndex = now.getMonth(); // 0-based 

    const startOfMonth = new Date(year, monthIndex, 1);
    const endOfMonth = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);

    const weeklyPipeline = [
      {
        $addFields: {
          eventDate: {
            $ifNull: [
              { $toDate: "$createdAt" },
              { $toDate: "$_id" }
            ]
          }
        },
      },
      {
        $match: {
          eventDate: {
            $gte: startOfMonth,
            $lte: endOfMonth,
          },
        },
      },
      {
        $group: {
          _id: {
            week: {
              $ceil: {
                $divide: [{ $dayOfMonth: "$eventDate" }, 7],
              },
            },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.week": 1 },
      },
    ];


    const tripsAgg = await RideHistory.aggregate(weeklyPipeline);
    const usersAgg = await Passenger.aggregate(weeklyPipeline);
    const driversAgg = await Driver.aggregate(weeklyPipeline);

    const map = new Map();

    const mergeAgg = (agg, fieldName) => {
      agg.forEach((row) => {
        const w = row._id.week;
        const key = `W${w}`;

        let base = map.get(key);
        if (!base) {
          base = {
            week: w,
            trips: 0,
            users: 0,
            drivers: 0,
          };
        }
        base[fieldName] = row.count;
        map.set(key, base);
      });
    };

    mergeAgg(tripsAgg, "trips");
    mergeAgg(usersAgg, "users");
    mergeAgg(driversAgg, "drivers");

    const result = Array.from(map.values())
      .sort((a, b) => a.week - b.week)
      .map((row) => ({
        // we still use "month" as the label key so the same chart works
        month: `Week ${row.week}`,
        trips: row.trips || 0,
        users: row.users || 0,
        drivers: row.drivers || 0,
      }));

    res.json(result);
  } catch (err) {
    console.error("Weekly stats error:", err);
    res.status(500).json({ error: "Failed to load weekly stats" });
  }
});

router.post("/admin/dev/seed-ridehistory", async (req, res) => {
  try {
    const { raw } = req.body;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "Missing raw JSON text" });
    }

    let docs;
    try {
      const parsed = JSON.parse(raw);
      docs = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      return res
        .status(400)
        .json({ error: "Invalid JSON", details: String(e) });
    }

    const cleaned = docs.map((d) => {
      const copy = { ...d };
      delete copy._id;
      return copy;
    });

    if (!cleaned.length) {
      return res.status(400).json({ error: "No documents to insert" });
    }

    const result = await RideHistory.insertMany(cleaned, { ordered: false });
    return res.json({ insertedCount: result.length });
  } catch (err) {
    console.error("[DEV SEED] Error seeding RideHistory:", err);
    return res.status(500).json({ error: "Failed to seed RideHistory" });
  }
});

router.post("/admin/dev/ridehistory-trim", async (req, res) => {
  try {
    const { month, count } = req.body;

    // month: "2025-09", count: number
    if (!month || typeof month !== "string") {
      return res.status(400).json({ error: "Missing or invalid month (expected 'YYYY-MM')." });
    }
    const n = Number(count);
    if (!n || n <= 0) {
      return res.status(400).json({ error: "Missing or invalid count (must be > 0)." });
    }

    const [yearStr, monthStr] = month.split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1; // JS Date: 0-based

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(monthIndex) ||
      monthIndex < 0 ||
      monthIndex > 11
    ) {
      return res.status(400).json({ error: "Invalid month format. Use 'YYYY-MM'." });
    }

    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);

    // 1) Find up to N docs for that month (by createdAt OR _id timestamp)
    const idsToDelete = await RideHistory.aggregate([
      {
        $addFields: {
          eventDate: {
            $ifNull: ["$createdAt", { $toDate: "$_id" }],
          },
        },
      },
      {
        $match: {
          eventDate: { $gte: start, $lt: end },
        },
      },
      {
        // delete the most recent ones first (you can flip to 1 for oldest first)
        $sort: { eventDate: -1, _id: -1 },
      },
      {
        $limit: n,
      },
      {
        $project: { _id: 1 },
      },
    ]);

    if (!idsToDelete.length) {
      return res.json({
        deletedCount: 0,
        message: `No RideHistory docs found for ${month}.`,
      });
    }

    const idList = idsToDelete.map((d) => d._id);

    // 2) Delete them
    const delResult = await RideHistory.deleteMany({ _id: { $in: idList } });

    return res.json({
      deletedCount: delResult.deletedCount,
      month,
    });
  } catch (err) {
    console.error("[DEV TRIM] Error trimming RideHistory:", err);
    return res.status(500).json({ error: "Failed to trim RideHistory" });
  }
});

router.post("/admin/dev/seed-passengers", async (req, res) => {
  try {
    const { raw } = req.body;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "Missing raw JSON text" });
    }

    let docs;
    try {
      const parsed = JSON.parse(raw);
      docs = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      return res
        .status(400)
        .json({ error: "Invalid JSON", details: String(e) });
    }

    const cleaned = docs.map((d) => {
      const copy = { ...d };
      delete copy._id;
      delete copy.__v;
      return copy;
    });

    if (!cleaned.length) {
      return res.status(400).json({ error: "No documents to insert" });
    }

    try {
      // 🔥 BYPASS MONGOOSE insertMany, use raw Mongo driver
      const rawResult = await Passenger.collection.insertMany(cleaned, {
        ordered: false,
      });

      return res.json({
        insertedCount: rawResult.insertedCount || 0,
        insertedIdsCount: Object.keys(rawResult.insertedIds || {}).length,
      });
    } catch (err) {
      console.error("[DEV SEED] Error in Passenger.collection.insertMany:", err);

      const payload = {
        error: "Failed to insert passengers",
        message: err.message,
        name: err.name,
        code: err.code,
      };

      if (Array.isArray(err.writeErrors)) {
        payload.writeErrors = err.writeErrors.map((we) => ({
          index: we.index,
          code: we.code,
          errmsg: we.errmsg,
          op: {
            email: we.op?.email,
            createdAt: we.op?.createdAt,
          },
        }));
      }

      return res.status(500).json(payload);
    }
  } catch (err) {
    console.error("[DEV SEED] Error seeding Passengers (outer):", err);
    return res.status(500).json({
      error: "Failed to seed Passengers",
      message: err.message,
      name: err.name,
    });
  }
});

// ========== DEV: TRIM PASSENGERS BY MONTH ==========
router.post("/admin/dev/passenger-trim", async (req, res) => {
  try {
    const { month, count } = req.body;

    if (!month || typeof month !== "string") {
      return res.status(400).json({ error: "Missing or invalid month (expected 'YYYY-MM')." });
    }
    const n = Number(count);
    if (!n || n <= 0) {
      return res.status(400).json({ error: "Missing or invalid count (must be > 0)." });
    }

    const [yearStr, monthStr] = month.split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(monthIndex) ||
      monthIndex < 0 ||
      monthIndex > 11
    ) {
      return res.status(400).json({ error: "Invalid month format. Use 'YYYY-MM'." });
    }

    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);

    const idsToDelete = await Passenger.aggregate([
      {
        $addFields: {
          eventDate: {
            $ifNull: ["$createdAt", { $toDate: "$_id" }],
          },
        },
      },
      {
        $match: { eventDate: { $gte: start, $lt: end } },
      },
      {
        $sort: { eventDate: -1, _id: -1 },
      },
      { $limit: n },
      { $project: { _id: 1 } },
    ]);

    if (!idsToDelete.length) {
      return res.json({
        deletedCount: 0,
        message: `No Passenger docs found for ${month}.`,
      });
    }

    const idList = idsToDelete.map((d) => d._id);
    const delResult = await Passenger.deleteMany({ _id: { $in: idList } });

    return res.json({
      deletedCount: delResult.deletedCount,
      month,
    });
  } catch (err) {
    console.error("[DEV TRIM] Error trimming Passengers:", err);
    return res.status(500).json({ error: "Failed to trim Passengers" });
  }
});

// ========== DEV: SEED DRIVERS ==========
router.post("/admin/dev/seed-drivers", async (req, res) => {
  try {
    const { raw } = req.body;
    if (!raw || typeof raw !== "string") {
      return res.status(400).json({ error: "Missing raw JSON text" });
    }

    let docs;
    try {
      const parsed = JSON.parse(raw);
      docs = Array.isArray(parsed) ? parsed : [parsed];
    } catch (e) {
      return res
        .status(400)
        .json({ error: "Invalid JSON", details: String(e) });
    }

    const cleaned = docs.map((d) => {
      const copy = { ...d };
      delete copy._id;
      delete copy.__v;
      return copy;
    });

    if (!cleaned.length) {
      return res.status(400).json({ error: "No documents to insert" });
    }

    const result = await Driver.insertMany(cleaned, { ordered: false });
    return res.json({ insertedCount: result.length });
  } catch (err) {
    console.error("[DEV SEED] Error seeding Drivers:", err);
    return res.status(500).json({ error: "Failed to seed Drivers" });
  }
});

// ========== DEV: TRIM DRIVERS BY MONTH ==========
router.post("/admin/dev/driver-trim", async (req, res) => {
  try {
    const { month, count } = req.body;

    if (!month || typeof month !== "string") {
      return res.status(400).json({ error: "Missing or invalid month (expected 'YYYY-MM')." });
    }
    const n = Number(count);
    if (!n || n <= 0) {
      return res.status(400).json({ error: "Missing or invalid count (must be > 0)." });
    }

    const [yearStr, monthStr] = month.split("-");
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;

    if (
      !Number.isInteger(year) ||
      !Number.isInteger(monthIndex) ||
      monthIndex < 0 ||
      monthIndex > 11
    ) {
      return res.status(400).json({ error: "Invalid month format. Use 'YYYY-MM'." });
    }

    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 1);

    const idsToDelete = await Driver.aggregate([
      {
        $addFields: {
          eventDate: {
            $ifNull: ["$createdAt", { $toDate: "$_id" }],
          },
        },
      },
      {
        $match: { eventDate: { $gte: start, $lt: end } },
      },
      {
        $sort: { eventDate: -1, _id: -1 },
      },
      { $limit: n },
      { $project: { _id: 1 } },
    ]);

    if (!idsToDelete.length) {
      return res.json({
        deletedCount: 0,
        message: `No Driver docs found for ${month}.`,
      });
    }

    const idList = idsToDelete.map((d) => d._id);
    const delResult = await Driver.deleteMany({ _id: { $in: idList } });


    return res.json({
      deletedCount: delResult.deletedCount,
      month,
    });
  } catch (err) {
    console.error("[DEV TRIM] Error trimming Drivers:", err);
    return res.status(500).json({ error: "Failed to trim Drivers" });
  }
});

// ========== DEV: CLEAR ALL GHOST PASSENGERS ==========
router.delete("/admin/dev/clear-passengers", async (req, res) => {
  try {
    // Adjust condition depending on how you define ghost users
    // Example: ghost = no email OR email contains "ghost"
    const result = await Passenger.deleteMany({
      $or: [
        { email: { $exists: false } },
        { email: null },
        { email: { $regex: /ghost/i } }
      ]
    });

    return res.json({
      deletedCount: result.deletedCount || 0,
    });
  } catch (err) {
    console.error("[DEV CLEAR] Error clearing passengers:", err);
    return res.status(500).json({ error: "Failed to clear ghost passengers" });
  }
});

// ========== DEV: CLEAR ALL GHOST DRIVERS ==========
router.delete("/admin/dev/clear-drivers", async (req, res) => {
  try {
    const result = await Driver.deleteMany({
      $or: [
        { email: { $exists: false } },
        { email: null },
        { email: { $regex: /ghost/i } }
      ]
    });

    return res.json({
      deletedCount: result.deletedCount || 0,
    });
  } catch (err) {
    console.error("[DEV CLEAR] Error clearing drivers:", err);
    return res.status(500).json({ error: "Failed to clear ghost drivers" });
  }
});


module.exports = router;
