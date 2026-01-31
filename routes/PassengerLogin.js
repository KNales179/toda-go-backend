// ✅ PassengerLogin.js
const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// POST /api/auth/passenger/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const passenger = await Passenger.findOne({ email });
    if (!passenger) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, passenger.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // ✅ create token
    const token = jwt.sign(
      { sub: String(passenger._id), role: "passenger" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.status(200).json({
      message: "Login successful",
      userId: passenger._id,
      token,
    });
  } catch (error) {
    console.error("Passenger login failed:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
