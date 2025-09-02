const express = require("express");
const router = express.Router();                
const Passenger = require("../models/Passenger");
const upload = require("../middleware/upload"); 
const path = require("path");

// UPDATE text fields (no images)
// PATCH /api/passenger/:id
router.get("/passenger/:id", async (req, res) => {
  try {
    const passenger = await Passenger.findById(req.params.id).select(
      "firstName middleName lastName birthday email profileImage gender contact Econtact isVerified"
    );
    if (!passenger) return res.status(404).json({ message: "Passenger not found" });

    res.status(200).json({ passenger });
  } catch (err) {
    console.error("❌ Failed to fetch passenger info:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/passengers", async (req, res) => {
  try {
    const passengers = await Passenger.find().select(
      "firstName middleName lastName email phone status"
    );
    res.status(200).json(passengers);
  } catch (error) {
    console.error("❌ Failed to fetch passengers:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.patch("/passenger/:id", async (req, res) => {
  try {
    const allowed = ["firstName","middleName","lastName","gender","contact","Econtact","birthday","email"];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

    const passenger = await Passenger.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!passenger) return res.status(404).json({ message: "Passenger not found" });

    res.status(200).json({ passenger });
  } catch (err) {
    console.error("❌ Passenger update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


router.post("/passenger/:id/photo", upload.single("profileImage"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });

    const relPath = path.join("uploads", req.file.filename);
    const passenger = await Passenger.findByIdAndUpdate(
      req.params.id,
      { profileImage: relPath },
      { new: true }
    );
    if (!passenger) return res.status(404).json({ message: "Passenger not found" });

    const avatarUrl = "/" + relPath.replace(/\\/g, "/");
    return res.status(200).json({ passenger, avatarUrl });
  } catch (err) {
    console.error("❌ Passenger photo error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;   