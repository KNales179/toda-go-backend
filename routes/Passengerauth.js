const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const upload = require("../middleware/upload"); // ✅ Use your existing Multer middleware!

// Register
router.post("/register-passenger", async (req, res) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      birthday,
      email,
      password,
    } = req.body;

    let passenger = await Passenger.findOne({ email });
    if (passenger) {
      return res.status(400).json({ error: "Passenger already exists" });
    }

    passenger = new Passenger({
      firstName,
      middleName,
      lastName,
      birthday,
      email,
      password,
    });

    await passenger.save();
    res.status(201).json({ message: "Passenger registered successfully" });
  } catch (error) {
    console.error("Registration failed:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

// Login
router.post("/login-passenger", async (req, res) => {
  try {
    const { email, password } = req.body;

    const passenger = await Passenger.findOne({ email });
    if (!passenger) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, passenger.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const payload = { id: passenger.id, email: passenger.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });

    res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

router.patch("/:id/update-profile-image", upload.single("profileImage"), async (req, res) => {
    console.log("🟢 Upload route hit. File:", req.file);
    try {
      const passengerId = req.params.id;
      const passenger = await Passenger.findById(passengerId);
      if (!passenger) {
        return res.status(404).json({ message: "Passenger not found" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No image uploaded." });
      }

      passenger.profileImage = req.file.path
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
