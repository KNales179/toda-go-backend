// routes/DriverInfo.js
const express = require("express");
const router = express.Router();                  // 👈 define router
const Driver = require("../models/Drivers");
const upload = require("../middleware/upload");   // 👈 needed for photo
const path = require("path");


router.get("/driver/:id", async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id).select(
      "profileID isLucenaVoter votingLocation createdAt driverFirstName driverMiddleName driverLastName driverName email driverPhone todaName franchiseNumber sector experienceYears selfieImage"
    );
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


router.patch("/driver/:id", async (req, res) => {
  try {
    const allowed = [
      "driverFirstName","driverMiddleName","driverLastName","driverName",
      "email","driverPhone","todaName","franchiseNumber","sector",
      "experienceYears","capacity","gender","driverBirthdate"
    ];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

    const driver = await Driver.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    res.status(200).json({ driver });
  } catch (err) {
    console.error("❌ Driver update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------- new photo upload ----------
router.post("/driver/:id/photo", upload.single("selfieImage"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });

    const relPath = path.join("uploads", req.file.filename); // e.g., uploads/123.jpg
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { selfieImage: relPath },
      { new: true }
    );
    if (!driver) return res.status(404).json({ message: "Driver not found" });

    const avatarUrl = "/" + relPath.replace(/\\/g, "/");      // -> /uploads/123.jpg
    return res.status(200).json({ driver, avatarUrl });
  } catch (err) {
    console.error("❌ Driver photo error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;                                     // 👈 export router (only once)
