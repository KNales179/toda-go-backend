const express = require("express");
const router = express.Router();

const Driver = require("../models/Drivers");
const DriverStatus = require("../models/DriverStatus");
const Report = require("../models/Report");

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

// 👉 REPORTS for dashboard (latest 5)
router.get("/admin/dashboard/reports", async (req, res) => {
  try {
    const reports = await Report.find({})
      .sort({ submittedAt: -1 })
      .limit(5);

    res.json(reports);
  } catch (err) {
    console.error("Dashboard reports error:", err);
    res.status(500).json({ error: "Failed to load reports" });
  }
});

module.exports = router;
