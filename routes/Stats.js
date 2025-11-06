// routes/stats.js
const express = require("express");
const router = express.Router();

const Booking = require("../models/Bookings");
const Driver = require("../models/Drivers");
const Passenger = require("../models/Passengers"); // used by /counts
const DriverPresence = require("../models/DriverPresence");

const TZ = "Asia/Manila";

// ---------- helpers ----------
function windowBounds(window = "7d") {
  const now = new Date();

  if (window === "today") {
    // exact Manila midnight → next Manila midnight
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now);
    const y = parts.find(p => p.type === "year").value;
    const m = parts.find(p => p.type === "month").value;
    const d = parts.find(p => p.type === "day").value;

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

// Build "YYYY-MM-DD" in Manila for eq comparisons (rarely needed if start/end are correct)
function todayString() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

// Reusable expr for pipelines (must be added via $addFields first)
const completedDateExpr = { $ifNull: ["$completedAt", "$updatedAt"] };

// Match helper against $bucketAt (added by $addFields)
const bucketWindowMatch = (start, end, isOverall) =>
  isOverall
    ? {}
    : {
        $expr: {
          $and: [
            { $gte: ["$bucketAt", start] },
            { $lt: ["$bucketAt", end] },
          ],
        },
      };

// ---------- A) Counts (optional) ----------
router.get("/counts", async (req, res) => {
  try {
    const driverCount = await Driver.countDocuments();
    const passengerCount = await Passenger.countDocuments();
    res.json({ driverCount, passengerCount });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch counts" });
  }
});

// ---------- B) Profile ----------
router.get("/driver/:driverId/profile", async (req, res) => {
  try {
    const { driverId } = req.params;

    const d = await Driver.findById(driverId).select(
      "driverFirstName driverLastName driverName selfieImage rating ratingCount"
    );
    if (!d) return res.status(404).json({ message: "Driver not found" });

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

// ---------- C) Summary (KPIs + daily series) ----------
router.get("/driver/:driverId/summary", async (req, res) => {
  try {
    const { driverId } = req.params;
    const window = String(req.query.window || "7d").toLowerCase();
    const { start, end } = windowBounds(window);
    const isOverall = window === "overall";

    console.log("\n===== [DEBUG] DRIVER SUMMARY =====");
    console.log("Driver:", driverId);
    console.log("Window:", window);
    console.log("Start:", start.toISOString());
    console.log("End:", end.toISOString());

    // Daily series
    const daily = await Booking.aggregate([
      { $addFields: { bucketAt: completedDateExpr } },
      { $match: { driverId, status: "completed" } },
      { $match: bucketWindowMatch(start, end, isOverall) },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: "%Y-%m-%d", date: "$bucketAt", timezone: TZ } },
          },
          trips: { $sum: 1 },
          income: { $sum: { $ifNull: ["$fare", 0] } },
        },
      },
      { $sort: { "_id.day": 1 } },
    ]);

    console.log("Daily buckets:", daily);

    const kpiAgg = await Booking.aggregate([
      { $addFields: { bucketAt: completedDateExpr } },
      { $match: { driverId, status: "completed" } },
      { $match: bucketWindowMatch(start, end, isOverall) },
      {
        $group: {
          _id: null,
          trips: { $sum: 1 },
          income: { $sum: { $ifNull: ["$fare", 0] } },
        },
      },
    ]);

    const kpis = kpiAgg[0] || { trips: 0, income: 0 };
    console.log("KPI Agg:", kpis);

    const [acceptedCount, canceledCount] = await Promise.all([
      Booking.countDocuments({
        driverId,
        acceptedAt: isOverall ? { $ne: null } : { $gte: start, $lt: end },
      }),
      Booking.countDocuments({
        driverId,
        status: "canceled",
        canceledAt: isOverall ? { $ne: null } : { $gte: start, $lt: end },
      }),
    ]);
    console.log("Accepted:", acceptedCount, "Canceled:", canceledCount);

    const hoursDoc =
      (
        await DriverPresence.aggregate([
          { $match: { driverId, startAt: { $lt: end }, endAt: { $gt: start } } },
          { $project: { clipStart: { $cond: [{ $gt: ["$startAt", start] }, "$startAt", start] }, clipEnd: { $cond: [{ $lt: ["$endAt", end] }, "$endAt", end] } } },
          { $project: { minutes: { $divide: [{ $subtract: ["$clipEnd", "$clipStart"] }, 60000] } } },
          { $group: { _id: null, minutes: { $sum: "$minutes" } } },
          { $project: { _id: 0, hoursOnline: { $divide: ["$minutes", 60] } } },
        ])
      )[0] || { hoursOnline: 0 };
    console.log("Hours online:", hoursDoc);

    res.json({
      window,
      kpis,
      acceptedCount,
      canceledCount,
      hoursDoc,
      daily,
    });
  } catch (e) {
    console.error("[DEBUG ERROR]", e);
    res.status(500).json({ message: "Server error" });
  }
});


// ---------- D) Monthly income ----------
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
            $and: [
              { $gte: ["$bucketAt", yearStart] },
              { $lt: ["$bucketAt", yearEnd] },
            ],
          },
        },
      },
      {
        $group: {
          _id: { m: { $toInt: { $dateToString: { format: "%m", date: "$bucketAt", timezone: TZ } } } },
          income: { $sum: { $ifNull: ["$fare", 0] } },
          trips: { $sum: 1 },
        },
      },
      { $project: { _id: 0, month: "$_id.m", income: 1, trips: 1 } },
      { $sort: { month: 1 } },
    ]);

    const out = [];
    for (let m = 1; m <= 12; m++) {
      const row = months.find(r => r.month === m) || { month: m, income: 0, trips: 0 };
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

// ---------- E) Report table ----------
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
          { $project: { minutes: { $divide: [{ $subtract: ["$clipEnd", "$clipStart"] }, 60000] } } },
          { $group: { _id: null, minutes: { $sum: "$minutes" } } },
          { $project: { _id: 0, hoursOnline: { $divide: ["$minutes", 60] } } },
        ])
      )[0] || { hoursOnline: 0 };

    const d = await Driver.findById(driverId).select("rating ratingCount");
    let avgRating = Number(d?.rating || 0);
    if (avgRating > 5 && d?.ratingCount > 0) avgRating = avgRating / d.ratingCount;

    // (Optional) accept/cancel table rows could be added similarly to summary if you want
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
