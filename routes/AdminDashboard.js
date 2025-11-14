const express = require("express");
const router = express.Router();

const Driver = require("../models/Drivers");
const DriverStatus = require("../models/DriverStatus");
const Report = require("../models/Report");
const Passenger = require("../models/Passenger");

// 👉 DRIVERS for dashboard (merge Driver + DriverStatus, online on top)
router.get("/admin/dashboard/drivers", async (req, res) => {
  try {
    const [drivers, statuses] = await Promise.all([
      Driver.find({}),           // you can filter { driverVerified: true } if you want
      DriverStatus.find({}),
    ]);

    const statusMap = new Map(
      statuses.map((st) => [String(st.driverId), st])
    );

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
    const reports = await Report.find({})
      .sort({ submittedAt: -1 })
      .limit(10);

    const enriched = [];

    for (const r of reports) {
      let reporterName = "Unknown";

      if (r.passengerId) {
        const p = await Passenger.findById(r.passengerId).lean();
        if (p) {
          reporterName = `${p.firstName} ${p.lastName}`;
        }
      }

      enriched.push({
        ...r.toObject(),
        reporterName,
      });
    }

    res.json(enriched);
  } catch (err) {
    console.error("Dashboard reports error:", err);
    res.status(500).json({ error: "Failed to load reports" });
  }
});

module.exports = router;
