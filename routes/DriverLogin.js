// routes/DriverLogin.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const Driver = require("../models/Drivers");
const Operator = require("../models/Operator");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const [driver, operator] = await Promise.all([
      Driver.findOne({ email }),
      Operator.findOne({ email }),
    ]);

    if (!driver && !operator) {
      return res.status(404).json({ error: "Email does not exist" });
    }

    // Compare only if record exists and has a password
    const driverOk = driver && driver.password
      ? await bcrypt.compare(password, driver.password)
      : false;

    const operatorOk = operator && operator.password
      ? await bcrypt.compare(password, operator.password)
      : false;

    // If both exist and both passwords match, prefer "Both" (must share profileID)
    if (driver && operator && driverOk && operatorOk) {
      if (driver.profileID !== operator.profileID) {
        return res.status(400).json({ error: "Conflict: Profile IDs do not match" });
      }
      if (!driver.isVerified) {
        return res.status(403).json({ error: "Email not verified", needVerification: true, userType: "Driver" });
      }
      if (!operator.isVerified) {
        return res.status(403).json({ error: "Email not verified", needVerification: true, userType: "Operator" });
      }
      return res.status(200).json({
        message: "Login successful",
        userType: "Both",
        userId: driver._id,
        driver, // include full driver doc if you need it
      });
    }

    // Driver-only success
    if (driver && driverOk) {
      if (!driver.isVerified) {
        return res.status(403).json({ error: "Email not verified", needVerification: true, userType: "Driver" });
      }
      return res.status(200).json({
        message: "Login successful",
        userType: "Driver",
        userId: driver._id,
        driver,
      });
    }

    // Operator-only success
    if (operator && operatorOk) {
      if (!operator.isVerified) {
        return res.status(403).json({ error: "Email not verified", needVerification: true, userType: "Operator" });
      }
      return res.status(200).json({
        message: "Login successful",
        userType: "Operator",
        userId: operator._id,
        operator,
      });
    }

    // If we got here, at least one record exists but the password didn’t match
    return res.status(400).json({ error: "Incorrect password" });
  } catch (error) {
    console.error("Driver login failed:", error);
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

module.exports = router;
