// routes/AdminDashboard.js
const express = require("express");
const router = express.Router();
const Driver = require("../models/Drivers");
const DriverStatus = require("../models/DriverStatus");
const Report = require("../models/Reports");

// GET /api/admin/dashboard/drivers
router.get("/admin/dashboard/drivers", async (req, res) => {
  try {
    const [drivers, statuses] = await Promise.all([
      Driver.find({}), // you can filter verified only if needed
      DriverStatus.find({}),
    ]);

    const statusMap = new Map(
      statuses.map((s) => [String(s.driverId), s]) // adjust field if different
    );

    const merged = drivers.map((d) => {
      const s = statusMap.get(String(d._id));
      const online = !!(s && s.online);
      return {
        _id: d._id,
        driverName: d.driverName || `${d.firstName || ""} ${d.lastName || ""}`.trim(),
        firstName: d.firstName || "",
        lastName: d.lastName || "",
        franchiseNumber: d.franchiseNumber || d.registrationNo || "",
        plateNumber: d.plateNumber || d.plateNo || "",
        todaName: d.todaName || d.toda || "",
        online,
        status: online ? "online" : (d.status || "offline"),
      };
    });

    // Online first, then alphabetical
    merged.sort((a, b) => {
      if (a.online === b.online) {
        return (a.driverName || "").localeCompare(b.driverName || "");
      }
      return a.online ? -1 : 1; // online first
    });

    // Limit to top 5 for dashboard
    res.json(merged.slice(0, 5));
  } catch (err) {
    console.error("Dashboard drivers error:", err);
    res.status(500).json({ error: "Failed to load driver dashboard data" });
  }
});

// GET /api/admin/dashboard/reports
router.get("/admin/dashboard/reports", async (req, res) => {
  try {
    const reports = await Report.find({})
      .sort({ createdAt: -1 })
      .limit(5);

    res.json(reports);
  } catch (err) {
    console.error("Dashboard reports error:", err);
    res.status(500).json({ error: "Failed to load reports" });
  }
});

module.exports = router;
