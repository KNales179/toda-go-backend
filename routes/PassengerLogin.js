// ✅ PassengerLogin.js
const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const bcrypt = require("bcryptjs");

// POST /api/auth/passenger/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const t0 = Date.now();

    // Find passenger by email
    const passenger = await Passenger.findOne({ email }).select('_id password').lean();
    console.log('[PLogin] findOne(ms):', Date.now() - t0);

    if (!passenger) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const t1 = Date.now();
    const isMatch = await bcrypt.compare(password, passenger.password);
    console.log('[PLogin] bcrypt(ms):', Date.now() - t1, 'total(ms):', Date.now() - t0);

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
