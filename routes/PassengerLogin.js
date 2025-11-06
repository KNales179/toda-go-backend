// ✅ PassengerLogin.js
const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const bcrypt = require("bcryptjs");

// POST /api/auth/passenger/login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const passenger = await Passenger.findOne({ email });
    if (!passenger) return res.status(400).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, passenger.password || "");
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    if (!passenger.isVerified) {
      return res.status(403).json({ error: "Email not verified", needVerification: true });
    }

    const payload = { id: passenger.id, email: passenger.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });

    return res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

module.exports = router;
