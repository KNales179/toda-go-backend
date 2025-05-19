// ✅ Create a new backend route file: routes/PassengerInfo.js

const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");

// GET /api/passenger/:id ➜ fetch name details of a passenger by _id
router.get("/passenger/:id", async (req, res) => {
  try {
    const passenger = await Passenger.findById(req.params.id).select("firstName middleName lastName");
    if (!passenger) return res.status(404).json({ message: "Passenger not found" });

    res.status(200).json({ passenger });
  } catch (err) {
    console.error("❌ Failed to fetch passenger info:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
