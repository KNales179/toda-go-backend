// ✅ PassengerLogin.js
const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const bcrypt = require("bcryptjs");

// POST /api/auth/passenger/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find passenger by email
    const passenger = await Passenger.findOne({ email });

    if (!passenger) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, passenger.password);

    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Successful login
    res.status(200).json({
      message: "Login successful",
      userId: passenger._id,
    });

  } catch (error) {
    console.error("Passenger login failed:", error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
