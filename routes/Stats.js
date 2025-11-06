// routes/stats.js
const express = require("express");
const router = express.Router();

const Booking = require("../models/Bookings");
const Driver = require("../models/Drivers");
const Passenger = require("../models/Passenger"); // used by /counts
const DriverPresence = require("../models/DriverPresence");

const TZ = "Asia/Manila";

/** ---------------- helpers ---------------- **/
function windowBounds(window = "7d") {
  const now = new Date();

  if (window === "today") {
    // 00:00 Manila → next 00:00 Manila
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);

    const y = parts.find((p) => p.type === "year").value;
    const m = parts.find((p) => p.type === "month").value;
    const d = parts.find((p) => p.type === "day").value;

    const start = new Date(`${y}-${m}-${d}T00:00:00+08:00`);
    const end = new Date(`${y}-${m}-${d}T00:00:00+08:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  const end = now;
  let start;
  if (window === "7d") start = new Date(end.getTime() - 7 * 86400 * 1000);
  else if (window === "30d") start = new Date(end.getTime() - 30 * 86400 * 1000);
  else start = new Date(0);
  return { start, end };
}

// Completed rides use this bucket date (so “today” income works even if only updatedAt is set)
const completedDateExpr = { $ifNull: ["$completedAt", "$updatedAt"] };

// $match helper for pipelines that already did: { $addFields: { bucketAt: ... } }
const bucketWindowMatch = (start, end, isOverall) =>
  isOverall
    ? {}
    : {
        $expr: {
          $and: [{ $gte: ["$bucketAt", start] }, { $lt: ["$bucketAt", end] }],
        },
      };

/** ---------------- A) Counts (optional) ---------------- **/
router.get("/counts", async (req, res) => {
  try {
    const driverCount = await Driver.countDocuments();
    const passengerCount = await Passenger.countDocuments();
    res.json({ driverCount, passengerCount });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch counts" });
  }
});

/** ---------------- B) Profile ---------------- **/
router.get("/driver/:driverId/profile", async (req, res) => {
  try {
    const { driverId } = req.params;

    const d = await Driver.findById(driverId).select(
      "driverFirstName driverLastName driverName selfieImage rating ratingCount"
    );
    if (!d) return res.status(404).json({ message: "Driver not found" });

    // Keep this as completed trips overall (profile badge)
    const totalTrips = await Booking.countDocuments({ driverId, status: "completed" });

    const name =
      [d.driverFirstName, d.driverLastName].filter(Boolean).join(" ") ||
      d.driverName ||
      "Driver";

    let avgRating = Number(d.rating || 0);
    if (avgRating > 5 && d.ratingCount > 0) avgRating = avgRating / d.ratingCount;

    res.json({
      name,
      selfieUrl: d.selfieImage || null,
      avgRating: Number(avgRating.toFixed(2)),
      ratingCount: d.ratingCount || 0,
      totalTrips,
    });
  } catch (e) {
    console.error("stats profile error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

/** ---------------- C) Summary (KPIs + daily series) ---------------- **/
router.get("/driver/:driverId/summary", async (req, res) => {
  try {
    const { driverId } = req.params;
    const window = String(req.query.window || "7d").toLowerCase();
    const { start, end } = windowBounds(window);
    const isOverall = window === "overall";

    /* ---- 1) Status distribution for ALL bookings in the window (based on createdAt) ---- */
    const statusAgg = await Booking.aggregate([
      { $match: { driverId } },
      ...(isOverall
        ? []
        : [{ $match: { createdAt: { $gte: start, $lt: end } } }]),
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statusCounts = statusAgg.reduce(
      (acc, r) => {
        acc[r._id] = r.count;
        return acc;
      },
      { pending: 0, accepted: 0, enroute: 0, completed: 0, canceled: 0 }
    );

    const totalBookings =
      statusCounts.pending +
      statusCounts.accepted +
      statusCounts.enroute +
      statusCounts.completed +
      statusCounts.canceled;

    console.log( statusCounts, totalBookings);

    const completeRate = totalBookings
      ? statusCounts.completed / totalBookings
      : 0;
    const cancelRate = totalBookings ? statusCounts.canceled / totalBookings : 0;

    console.log(completeRate, cancelRate);

    /* ---- 2) Income/avgFare/daily series from COMPLETED rides (windowed by completedAt/updatedAt) ---- */
    const daily = await Booking.aggregate([
      { $addFields: { bucketAt: completedDateExpr } },
      { $match: { driverId, status: "completed" } },
      { $match: bucketWindowMatch(start, end, isOverall) },
      {
        $group: {
          _id: {
            day: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$bucketAt",
                timezone: TZ,
              },
            },
          },
          trips: { $sum: 1 },
          income: { $sum: { $ifNull: ["$fare", 0] } },
          cashIncome: {
            $sum: {
              $cond: [
                { $eq: ["$paymentMethod", "cash"] },
                { $ifNull: ["$fare", 0] },
                0,
              ],
            },
          },
          gcashIncome: {
            $sum: {
              $cond: [
                { $eq: ["$paymentMethod", "gcash"] },
                { $ifNull: ["$fare", 0] },
                0,
              ],
            },
          },
        },
      },
      { $sort: { "_id.day": 1 } },
      {
        $project: {
          _id: 0,
          date: "$_id.day",
          trips: 1,
          income: 1,
          cashIncome: 1,
          gcashIncome: 1,
        },
      },
    ]);

    const kpiAgg = await Booking.aggregate([
      { $addFields: { bucketAt: completedDateExpr } },
      { $match: { driverId, status: "completed" } },
      { $match: bucketWindowMatch(start, end, isOverall) },
      {
        $group: {
          _id: null,
          completedTrips: { $sum: 1 },
          income: { $sum: { $ifNull: ["$fare", 0] } },
          cashIncome: {
            $sum: {
              $cond: [
                { $eq: ["$paymentMethod", "cash"] },
                { $ifNull: ["$fare", 0] },
                0,
              ],
            },
          },
          gcashIncome: {
            $sum: {
              $cond: [
                { $eq: ["$paymentMethod", "gcash"] },
                { $ifNull: ["$fare", 0] },
                0,
              ],
            },
          },
          distanceKm: { $sum: { $ifNull: ["$distanceKm", 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          completedTrips: 1,
          income: 1,
          avgFare: {
            $cond: [
              { $gt: ["$completedTrips", 0] },
              { $divide: ["$income", "$completedTrips"] },
              0,
            ],
          },
          cashIncome: 1,
          gcashIncome: 1,
          distanceKm: 1,
        },
      },
    ]);

    const completedSide = kpiAgg[0] || {
      completedTrips: 0,
      income: 0,
      avgFare: 0,
      cashIncome: 0,
      gcashIncome: 0,
      distanceKm: 0,
    };

    /* ---- 3) Hours online (clip sessions to [start,end)) ---- */
    const hoursDoc =
      (
        await DriverPresence.aggregate([
          { $match: { driverId, startAt: { $lt: end }, endAt: { $gt: start } } },
          {
            $project: {
              clipStart: {
                $cond: [{ $gt: ["$startAt", start] }, "$startAt", start],
              },
              clipEnd: { $cond: [{ $lt: ["$endAt", end] }, "$endAt", end] },
            },
          },
          {
            $project: {
              minutes: {
                $divide: [{ $subtract: ["$clipEnd", "$clipStart"] }, 60000],
              },
            },
          },
          { $group: { _id: null, minutes: { $sum: "$minutes" } } },
          { $project: { _id: 0, hoursOnline: { $divide: ["$minutes", 60] } } },
        ])
      )[0] || { hoursOnline: 0 };

    /* ---- 4) Avg rating (stable) ---- */
    const d = await Driver.findById(driverId).select("rating ratingCount");
    let avgRating = Number(d?.rating || 0);
    if (avgRating > 5 && d?.ratingCount > 0) avgRating = avgRating / d.ratingCount;

    /* ---- response ---- */
    res.json({
      window,
      kpis: {
        // totals based on ALL bookings in window
        trips: totalBookings,

        // percentages you’ll display: Complete % and Cancel %
        completeRate,
        cancelRate,

        // money side from COMPLETED rides in window
        income: Number(completedSide.income.toFixed(2)),
        avgFare: Number(completedSide.avgFare.toFixed(2)),
        cashIncome: Number(completedSide.cashIncome.toFixed(2)),
        gcashIncome: Number(completedSide.gcashIncome.toFixed(2)),
        distanceKm: Number(completedSide.distanceKm.toFixed(2)),

        // others
        hoursOnline: Number(hoursDoc.hoursOnline.toFixed(1)),
        avgRating: Number((avgRating || 0).toFixed(2)),
      },
      daily, // for charts (completed rides timeline)
    });
  } catch (e) {
    console.error("stats summary error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

/** ---------------- D) Monthly income (completed rides) ---------------- **/
router.get("/driver/:driverId/monthly", async (req, res) => {
  try {
    const { driverId } = req.params;
    const year = Number(req.query.year) || new Date().getFullYear();

    const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
    const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`);

    const months = await Booking.aggregate([
      { $addFields: { bucketAt: completedDateExpr } },
      { $match: { driverId, status: "completed" } },
      {
        $match: {
          $expr: {
            $and: [{ $gte: ["$bucketAt", yearStart] }, { $lt: ["$bucketAt", yearEnd] }],
          },
        },
      },
      {
        $group: {
          _id: {
            m: {
              $toInt: {
                $dateToString: { format: "%m", date: "$bucketAt", timezone: TZ },
              },
            },
          },
          income: { $sum: { $ifNull: ["$fare", 0] } },
          trips: { $sum: 1 },
        },
      },
      { $project: { _id: 0, month: "$_id.m", income: 1, trips: 1 } },
      { $sort: { month: 1 } },
    ]);

    const out = [];
    for (let m = 1; m <= 12; m++) {
      const row = months.find((r) => r.month === m) || {
        month: m,
        income: 0,
        trips: 0,
      };
      out.push({
        month: m,
        income: Number((row.income || 0).toFixed(2)),
        trips: row.trips || 0,
      });
    }

    res.json({ year, months: out });
  } catch (e) {
    console.error("stats monthly error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

/** ---------------- E) Report table (completed rides + presence) ---------------- **/
router.get("/driver/:driverId/report", async (req, res) => {
  try {
    const { driverId } = req.params;
    const window = String(req.query.window || "day").toLowerCase();

    const map = { day: "today", week: "7d", month: "30d", overall: "overall" };
    const mapped = map[window] || "today";
    const { start, end } = windowBounds(mapped);
    const isOverall = mapped === "overall";

    const kpi = await Booking.aggregate([
      { $addFields: { bucketAt: completedDateExpr } },
      { $match: { driverId, status: "completed" } },
      { $match: bucketWindowMatch(start, end, isOverall) },
      {
        $group: {
          _id: null,
          dropoffs: { $sum: 1 },
          income: { $sum: { $ifNull: ["$fare", 0] } },
          distance: { $sum: { $ifNull: ["$distanceKm", 0] } },
        },
      },
      { $project: { _id: 0, dropoffs: 1, income: 1, distance: 1 } },
    ]);

    const base = kpi[0] || { dropoffs: 0, income: 0, distance: 0 };

    const hoursDoc =
      (
        await DriverPresence.aggregate([
          { $match: { driverId, startAt: { $lt: end }, endAt: { $gt: start } } },
          {
            $project: {
              clipStart: { $cond: [{ $gt: ["$startAt", start] }, "$startAt", start] },
              clipEnd: { $cond: [{ $lt: ["$endAt", end] }, "$endAt", end] },
            },
          },
          {
            $project: {
              minutes: {
                $divide: [{ $subtract: ["$clipEnd", "$clipStart"] }, 60000],
              },
            },
          },
          { $group: { _id: null, minutes: { $sum: "$minutes" } } },
          { $project: { _id: 0, hoursOnline: { $divide: ["$minutes", 60] } } },
        ])
      )[0] || { hoursOnline: 0 };

    const d = await Driver.findById(driverId).select("rating ratingCount");
    let avgRating = Number(d?.rating || 0);
    if (avgRating > 5 && d?.ratingCount > 0) avgRating = avgRating / d.ratingCount;

    res.json({
      window,
      rows: [
        { key: "dropoffs", label: "Successful drop-offs", value: base.dropoffs, unit: "" },
        { key: "income", label: "Total income", value: Number(base.income.toFixed(2)), unit: "PHP" },
        { key: "distance", label: "Distance traveled", value: Number((base.distance || 0).toFixed(1)), unit: "km" },
        { key: "avgRating", label: "Average rating", value: Number((avgRating || 0).toFixed(2)), unit: "★" },
        { key: "hoursOnline", label: "Hours online", value: Number(hoursDoc.hoursOnline.toFixed(1)), unit: "h" },
      ],
    });
  } catch (e) {
    console.error("stats report error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
