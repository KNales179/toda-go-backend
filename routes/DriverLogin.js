// routes/DriverLogin.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Driver = require("../models/Drivers");

function sanitize(doc) {
  if (!doc) return null;

  const o = doc.toObject ? doc.toObject() : { ...doc };
  delete o.password;
  return o;
}

function signUserToken({ sub, role, profileID, userType }) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is missing in env");

  return jwt.sign(
    {
      sub: String(sub),
      role: String(role).toLowerCase(),
      profileID: profileID || null,
      userType: userType || null,
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const driver = await Driver.findOne({ email: normalizedEmail });

    if (!driver) {
      return res.status(404).json({ error: "Email does not exist" });
    }

    const passwordMatch = await bcrypt.compare(password, driver.password || "");

    if (!passwordMatch) {
      return res.status(400).json({ error: "Incorrect password" });
    }

    const token = signUserToken({
      sub: driver._id,
      role: "driver",
      profileID: driver.profileID,
      userType: "driver",
    });

    return res.status(200).json({
      message: "Login successful",
      userType: "Driver",
      userId: driver._id,
      token,
      driver: sanitize(driver),

      // email verification
      needVerification: !driver.isVerified,
      isVerifiedDriver: !!driver.isVerified,

      // admin verification
      needAdminVerification: !driver.driverVerified,
      driverVerified: !!driver.driverVerified,
      driverVerification: driver.driverVerification || null,
    });
  } catch (error) {
    console.error("Driver login failed:", error);
    return res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
});

module.exports = router;