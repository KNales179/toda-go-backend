// routes/RideHistory.js
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const RideHistory = require("../models/RideHistory");
const Driver = require("../models/Drivers"); // <-- for name lookup

/* ADMIN — unchanged: returns all rides */
router.get("/rides", async (_req, res) => {
  try {
    const rides = await RideHistory.find().sort({ completedAt: -1 }).lean();
    res.status(200).json(rides);
  } catch (error) {
    console.error("❌ Failed to fetch all ride history:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* PASSENGER/DRIVER — sanitized: returns driverName only (no driverId) */
router.get("/ridehistory", async (req, res) => {
  try {
    const { passengerId = "", driverId = "" } = req.query;
    const filter = {};
    if (passengerId) filter.passengerId = String(passengerId).trim();
    if (driverId) filter.driverId = String(driverId).trim();

    console.log("🎯 Fetching ridehistory with filter:", filter);

    const rides = await RideHistory.find(filter)
      .sort({ completedAt: -1, _id: -1 })
      .lean();

    console.log("🧾 Raw rides fetched:", rides.length);
    if (rides.length > 0) {
      console.log("Example ride sample:", rides[0]);
    }

    const driverIds = [...new Set(rides.map(r => r.driverId).filter(Boolean))];
    console.log("🆔 Distinct driverIds:", driverIds);

    const toObjectIds = driverIds
      .map(id => (mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null))
      .filter(Boolean);

    let driversById = new Map();
    if (toObjectIds.length) {
      const drivers = await Driver.find({ _id: { $in: toObjectIds } })
        .select("driverName driverFirstName driverMiddleName driverLastName")
        .lean();

      console.log("👨‍✈️ Drivers found for mapping:", drivers.length);
      drivers.forEach(d => {
        const composed =
          d.driverName ||
          [d.driverFirstName, d.driverMiddleName, d.driverLastName]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        driversById.set(String(d._id), composed || "Driver");
      });
    }

    const items = rides.map(r => {
      const driverName = driversById.get(String(r.driverId)) || "Driver";
      return {
        _id: String(r._id),
        bookingId: r.bookingId,
        passengerId: r.passengerId,
        pickupLabel:
          r.pickupPlace || r.pickupLabel || r.pickupName || r.pickupAddress || "Pickup location",
        destinationLabel:
          r.destinationPlace || r.destinationLabel || r.destinationName || r.destinationAddress || "Destination",
        fare: r.fare ?? 0,
        paymentMethod: r.paymentMethod || "",
        notes: r.notes || "",
        createdAt: r.completedAt || r.createdAt || new Date(),
        driverName, // ✅ only this
      };
    });

    console.log("✅ Final ridehistory items (trimmed sample):", items.slice(0, 2));

    res.json({ items, total: items.length });
  } catch (error) {
    console.error("❌ Failed to fetch user ride history:", error);
    res.status(500).json({ error: "server_error" });
  }
});


router.delete("/ridehistory/:id", async (req, res) => {
  const { id } = req.params;
  try {
    console.log("🗑️  DELETE /ridehistory/:id", { id });

    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log("⛔ invalid ObjectId:", id);
      return res.status(400).json({ error: "invalid_id" });
    }

    const result = await RideHistory.deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    console.log("📉 deleteOne result:", result); // { acknowledged: true, deletedCount: N }

    if (result.deletedCount === 0) {
      console.log("🔎 not found:", id);
      return res.status(404).json({ error: "not_found" });
    }

    return res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (e) {
    console.error("❌ delete error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/* (Optional) keep your delete & report endpoints here if you added them
router.delete("/ridehistory/:id", async (req, res) => { ... })
router.post("/ridehistory/:id/report", async (req, res) => { ... })
*/

module.exports = router;
