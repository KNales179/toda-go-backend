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

  const yearStart = new Date(currentYear, 0, 1);          // Jan 1, current year
  const nextYearStart = new Date(currentYear + 1, 0, 1);  // Jan 1 next year

  return [
    {
      // Use createdAt if available, otherwise fall back to ObjectId timestamp
      $addFields: {
        eventDate: {
          $ifNull: ["$createdAt", { $toDate: "$_id" }],
        },
      },
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
    const tripsAgg = await RideHistory.aggregate(monthlyAggPipeline());
    const usersAgg = await Passenger.aggregate(monthlyAggPipeline());
    const driversAgg = await Driver.aggregate(monthlyAggPipeline());

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
          createdAtFromId: { $toDate: "$_id" },
        },
      },
      {
        $match: {
          createdAtFromId: {
            $gte: startOfMonth,
            $lte: endOfMonth,
          },
        },
      },
      {
        // Week-of-month: 1–5 (1 = days 1–7, 2 = 8–14, etc.)
        $group: {
          _id: {
            week: {
              $ceil: {
                $divide: [{ $dayOfMonth: "$createdAtFromId" }, 7],
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

module.exports = router;
