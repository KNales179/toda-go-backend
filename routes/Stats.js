// routes/Stats.js
const express = require("express");
const router = express.Router();

const Booking = require("../models/Bookings");
const Driver = require("../models/Drivers");
const DriverPresence = require("../models/DriverPresence");

const TZ = "Asia/Manila";

// ----- time window helpers (Manila-correct “today”) -----
function windowBounds(window = "7d") {
  const now = new Date();

  if (window === "today") {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(now);

    const y = parts.find(p => p.type === "year").value;
    const m = parts.find(p => p.type === "month").value;
    const d = parts.find(p => p.type === "day").value;

    const start = new Date(`${y}-${m}-${d}T00:00:00+08:00`);
    const end   = new Date(`${y}-${m}-${d}T00:00:00+08:00`);
    end.setUTCDate(end.getUTCDate() + 1); // next local midnight
    return { start, end };
  }

  const end = now;
  let start;
  if (window === "7d") start = new Date(end.getTime() - 7 * 86400 * 1000);
  else if (window === "30d") start = new Date(end.getTime() - 30 * 86400 * 1000);
  else start = new Date(0); // overall
  return { start, end };
}

const completedDateExpr = { $ifNull: ["$completedAt", "$updatedAt"] };

// ---------- A) Profile ----------
router.get("/driver/:driverId/profile", async (req, res) => {
  try {
    const { driverId } = req.params;
    const d = await Driver.findById(driverId).select(
      "driverFirstName driverLastName driverName selfieImage rating ratingCount"
    );
    if (!d) return res.status(404).json({ message: "Driver not found" });

    const totalTrips = await Booking.countDocuments({ driverId }); // all statuses, lifetime

    const name =
      [d.driverFirstName, d.driverLastName].filter(Boolean).join(" ") ||
      d.driverName ||
      "Driver";

    let avgRating = Number(d.rating || 0);
    if (avgRating > 5 && d.ratingCount > 0) {
      avgRating = avgRating / d.ratingCount;
    }

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

// ---------- B) Summary (Trips = all bookings; Complete%/Cancel%) ----------
router.get("/driver/:driverId/summary", async (req, res) => {
  try {
    const { driverId } = req.params;
    const window = (req.query.window || "7d").toLowerCase();
    const { start, end } = windowBounds(window);
    const isOverall = window === "overall";

    // 1) Status distribution over ALL bookings in-window (by createdAt)
    const createdFilter = isOverall
      ? { driverId }
      : { driverId, createdAt: { $gte: start, $lt: end } };

    const byStatus = await Booking.aggregate([
      { $match: createdFilter },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const counts = {
      pending: 0,
      accepted: 0,
      enroute: 0,
      completed: 0,
      canceled: 0,
    };
    let total = 0;
    for (const row of byStatus) {
      const s = String(row._id || "");
      if (s === "pending") counts.pending = row.count;
      else if (s === "accepted") counts.accepted = row.count;
      else if (s === "enroute") counts.enroute = row.count;
      else if (s === "completed") counts.completed = row.count;
      else if (s === "canceled") counts.canceled = row.count;
      total += row.count;
    }

    const completeRate = total ? counts.completed / total : 0;
    const cancelRate = total ? counts.canceled / total : 0;

    // 2) Money KPIs computed over COMPLETED bookings in-window (by completedAt)
    const completedFilter = isOverall
      ? { driverId, status: "completed" }
      : { driverId, status: "completed", completedAt: { $gte: start, $lt: end } };

    const moneyAgg = await Booking.aggregate([
      { $match: completedFilter },
      {
        $group: {
          _id: null,
          trips: { $sum: 1 }, // completed trips (money-relevant)
          income: { $sum: { $ifNull: ["$fare", 0] } },
          cashIncome: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "cash"] }, { $ifNull: ["$fare", 0] }, 0],
            },
          },
          gcashIncome: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "gcash"] }, { $ifNull: ["$fare", 0] }, 0],
            },
          },
          distanceKm: { $sum: { $ifNull: ["$distanceKm", 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          trips: 1,
          income: 1,
          avgFare: { $cond: [{ $gt: ["$trips", 0] }, { $divide: ["$income", "$trips"] }, 0] },
          cashIncome: 1,
          gcashIncome: 1,
          distanceKm: 1,
        },
      },
    ]);

    const money = moneyAgg[0] || {
      trips: 0,
      income: 0,
      avgFare: 0,
      cashIncome: 0,
      gcashIncome: 0,
      distanceKm: 0,
    };

    // 3) Hours online (clip to window) from DriverPresence
    const presenceFilter = isOverall
      ? { driverId } // include all presence
      : { driverId, startAt: { $lt: end }, endAt: { $gt: start } }; // overlap

    const hoursDoc =
      (
        await DriverPresence.aggregate([
          { $match: presenceFilter },
          {
            $project: {
              clipStart: isOverall ? "$startAt" : { $cond: [{ $gt: ["$startAt", start] }, "$startAt", start] },
              clipEnd:   isOverall ? "$endAt"   : { $cond: [{ $lt: ["$endAt", end] }, "$endAt", end] },
            },
          },
          {
            $project: {
              minutes: { $divide: [{ $subtract: ["$clipEnd", "$clipStart"] }, 60000] },
            },
          },
          { $group: { _id: null, minutes: { $sum: "$minutes" } } },
          { $project: { _id: 0, hoursOnline: { $divide: ["$minutes", 60] } } },
        ])
      )[0] || { hoursOnline: 0 };

    // 4) Daily series (for charts)
    //    Keep income based on completedAt (money happens when completed)
    const dailyFilter = isOverall
      ? { driverId, status: "completed" }
      : { driverId, status: "completed", completedAt: { $gte: start, $lt: end } };

    const daily = await Booking.aggregate([
      { $addFields: { bucketAt: completedDateExpr } },
      { $match: dailyFilter },
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
              $cond: [{ $eq: ["$paymentMethod", "cash"] }, { $ifNull: ["$fare", 0] }, 0],
            },
          },
          gcashIncome: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "gcash"] }, { $ifNull: ["$fare", 0] }, 0],
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

    // 5) Average rating (stable regardless of window)
    const d = await Driver.findById(driverId).select("rating ratingCount");
    let avgRating = Number(d?.rating || 0);
    if (avgRating > 5 && d?.ratingCount > 0) avgRating = avgRating / d.ratingCount;

    res.json({
      window,
      // show ALL bookings as "Trips"
      kpis: {
        trips: total, // 👈 ALL bookings in window
        completeRate: Number( (completeRate || 0).toFixed(4) ),
        cancelRate:   Number( (cancelRate   || 0).toFixed(4) ),

        // money KPIs (completed-only)
        income: Number(money.income.toFixed(2)),
        avgFare: Number(money.avgFare.toFixed(2)),
        cashIncome: Number(money.cashIncome.toFixed(2)),
        gcashIncome: Number(money.gcashIncome.toFixed(2)),
        distanceKm: Number(money.distanceKm.toFixed(1)),

        // presence & rating
        hoursOnline: Number((hoursDoc.hoursOnline || 0).toFixed(1)),
        avgRating: Number((avgRating || 0).toFixed(2)),
      },
      daily,
    });
  } catch (e) {
    console.error("stats summary error:", e);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- C) Monthly income (unchanged logic; completed-at windowing) ----------
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
          _id: {
            m: {
              $toInt: {
                $dateToString: {
                  format: "%m",
                  date: "$bucketAt",
                  timezone: TZ,
                },
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
      const row = months.find((r) => r.month === m) || { month: m, income: 0, trips: 0 };
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

// ---------- D) Report table (kept as before; can switch later if you want) ----------
router.get("/driver/:driverId/report", async (req, res) => {
  try {
    const { driverId } = req.params;
    const window = (req.query.window || "day").toLowerCase();

    const map = { day: "today", week: "7d", month: "30d", overall: "overall" };
    const mapped = map[window] || "today";
    const { start, end } = windowBounds(mapped);
    const isOverall = mapped === "overall";

    const kpi = await Booking.aggregate([
      { $addFields: { bucketAt: completedDateExpr } },
      isOverall
        ? { $match: { driverId, status: "completed" } }
        : { $match: { driverId, status: "completed", completedAt: { $gte: start, $lt: end } } },
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
          isOverall
            ? { $match: { driverId } }
            : { $match: { driverId, startAt: { $lt: end }, endAt: { $gt: start } } },
          {
            $project: {
              clipStart: isOverall ? "$startAt" : { $cond: [{ $gt: ["$startAt", start] }, "$startAt", start] },
              clipEnd:   isOverall ? "$endAt"   : { $cond: [{ $lt: ["$endAt", end] }, "$endAt", end] },
            },
          },
          {
            $project: {
              minutes: { $divide: [{ $subtract: ["$clipEnd", "$clipStart"] }, 60000] },
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
        { key: "distance", label: "Distance traveled", value: Number(base.distance.toFixed(1)), unit: "km" },
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
