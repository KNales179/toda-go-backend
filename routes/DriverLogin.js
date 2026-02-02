// routes/DriverLogin.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Driver = require("../models/Drivers");
const Operator = require("../models/Operator");

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
    { sub: String(sub), role: String(role).toLowerCase(), profileID: profileID || null, userType: userType || null },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const driver = (await Driver.findOne({ email })) || null;
    const operator = (await Operator.findOne({ email })) || null;

    if (!driver && !operator) {
      return res.status(404).json({ error: "Email does not exist" });
    }

    const driverPasswordMatch = driver
      ? await bcrypt.compare(password, driver.password || "")
      : false;

    const operatorPasswordMatch = operator
      ? await bcrypt.compare(password, operator.password || "")
      : false;

    // BOTH
    if (driver && driverPasswordMatch && operator && operatorPasswordMatch) {
      if (driver.profileID !== operator.profileID) {
        return res.status(400).json({ error: "Conflict: Profile IDs do not match" });
      }

      // ✅ Driver app will use this token (role=driver) for /api/notifications?userType=driver
      const token = signUserToken({
        sub: driver._id,
        role: "driver",
        profileID: driver.profileID,
        userType: "both",
      });

      return res.status(200).json({
        message: "Login successful",
        userType: "Both",
        userId: driver._id,
        token,

        // Safe objects
        driver: sanitize(driver),
        operator: sanitize(operator),

        // informational flags
        needVerification: !(driver.isVerified && operator.isVerified),
        isVerifiedDriver: !!driver.isVerified,
        isVerifiedOperator: !!operator.isVerified,
      });
    }

    // DRIVER
    if (driver && driverPasswordMatch) {
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

        needVerification: !driver.isVerified,
        isVerifiedDriver: !!driver.isVerified,
      });
    }

    // OPERATOR
    if (operator && operatorPasswordMatch) {
      // If later you also want operator app to have internal notifications, you can add userType=operator handling.
      const token = signUserToken({
        sub: operator._id,
        role: "operator",
        profileID: operator.profileID,
        userType: "operator",
      });

      return res.status(200).json({
        message: "Login successful",
        userType: "Operator",
        userId: operator._id,
        token,
        operator: sanitize(operator),

        needVerification: !operator.isVerified,
        isVerifiedOperator: !!operator.isVerified,
      });
    }

    return res.status(400).json({ error: "Incorrect password" });
  } catch (error) {
    console.error("Driver login failed:", error);
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

module.exports = router;
