// routes/adminstats.js
const express = require("express");
const router = express.Router();

const RideHistory = require("../models/RideHistory");
const Passenger = require("../models/Passenger");
const Driver = require("../models/Drivers");

// --- Helper: Build monthly aggregation pipeline ---
function monthlyAggPipeline() {
  return [
    {
      $addFields: {
        createdAtFromId: { $toDate: "$_id" },
      },
    },
    {
      $match: {
        createdAtFromId: {
          $gte: new Date(
            new Date().getFullYear(),
            new Date().getMonth() - 5,
            1
          ),
        },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAtFromId" },
          month: { $month: "$createdAtFromId" },
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


router.get("/admin/stats/weekly", async (req, res) => {
  try {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-11

    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month + 1, 1);

    // Helper – get week index (0–3)
    function getWeekIndex(date) {
      const start = new Date(year, month, 1);
      const diff = (date - start) / (1000 * 60 * 60 * 24);
      return Math.floor(diff / 7); // 7-day buckets
    }

    // Prepare blank weeks
    const weeks = [
      { week: "Week 1", trips: 0, users: 0, drivers: 0 },
      { week: "Week 2", trips: 0, users: 0, drivers: 0 },
      { week: "Week 3", trips: 0, users: 0, drivers: 0 },
      { week: "Week 4", trips: 0, users: 0, drivers: 0 },
    ];

    // Aggregation pipeline:
    const pipeline = [
      {
        $addFields: {
          createdAtFromId: { $toDate: "$_id" }
        }
      },
      {
        $match: {
          createdAtFromId: { $gte: monthStart, $lt: monthEnd }
        }
      },
      {
        $project: {
          createdAtFromId: 1
        }
      }
    ];

    // Run aggs
    const trips = await RideHistory.aggregate(pipeline);
    const users = await Passenger.aggregate(pipeline);
    const drivers = await Driver.aggregate(pipeline);

    // Fill trips
    trips.forEach(r => {
      const w = getWeekIndex(r.createdAtFromId);
      if (w >= 0 && w < 4) weeks[w].trips++;
    });

    // Fill users
    users.forEach(r => {
      const w = getWeekIndex(r.createdAtFromId);
      if (w >= 0 && w < 4) weeks[w].users++;
    });

    // Fill drivers
    drivers.forEach(r => {
      const w = getWeekIndex(r.createdAtFromId);
      if (w >= 0 && w < 4) weeks[w].drivers++;
    });

    res.json(weeks);
  } catch (err) {
    console.error("Weekly stats error:", err);
    res.status(500).json({ error: "Failed to load weekly stats" });
  }
});


module.exports = router;
