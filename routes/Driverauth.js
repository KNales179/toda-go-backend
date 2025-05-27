const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const upload = require("../middleware/upload");

// PATCH: Upload passenger profile image
router.patch(
  "/api/passenger/:id/update-profile-image",
  upload.single("profileImage"), // Field name must match frontend
  async (req, res) => {
    try {
      const passengerId = req.params.id;
      const passenger = await Passenger.findById(passengerId);
      if (!passenger) {
        return res.status(404).json({ message: "Passenger not found" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No image uploaded." });
      }

      passenger.profileImage = req.file.path; // Save file path
      await passenger.save();

      res.status(200).json({
        passenger,
        message: "Profile image updated!",
      });
    } catch (error) {
      console.error("❌ Error updating passenger profile image:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

module.exports = router;
