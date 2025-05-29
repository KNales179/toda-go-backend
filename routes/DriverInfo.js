const express = require("express");
const router = express.Router();
const Driver = require("../models/Drivers");

// GET /api/driver/:id ➜ fetch driver's name and info by _id
router.get("/driver/:id", async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id).select("profileID isLucenaVoter votingLocation createdAt driverFirstName driverMiddleName driverLastName driverName email driverPhone todaName franchiseNumber sector experienceYears selfieImage");
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    res.status(200).json({ driver });
  } catch (err) {
    console.error("❌ Failed to fetch driver info:", err);
    res.status(500).json({ message: "Server error" });
  }
});


router.get("/drivers", async (req, res) => {
  try {
    const drivers = await Driver.find().select(
      "profileID isLucenaVoter votingLocation createdAt driverFirstName driverMiddleName driverLastName driverName email driverPhone todaName franchiseNumber sector experienceYears selfieImage"
    );
    res.status(200).json(drivers);
  } catch (error) {
    console.error("❌ Failed to fetch drivers:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
