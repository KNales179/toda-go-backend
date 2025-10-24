// routes/DriverLogin.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const Driver = require("../models/Drivers");
const Operator = require("../models/Operator");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const T0 = Date.now();

    const [driver, operator] = await Promise.all([
      Driver.findOne({ email })
        .select('_id password isVerified profileID driverName')
        .lean(),
      Operator.findOne({ email })
        .select('_id password isVerified profileID operatorName')
        .lean(),
    ]);
    console.log('[DLogin] findOne both(ms):', Date.now() - T0);

    const T1 = Date.now();
    const driverPasswordMatch = driver ? await bcrypt.compare(password, driver.password || '') : false;
    const operatorPasswordMatch = operator ? await bcrypt.compare(password, operator.password || '') : false;
    console.log('[DLogin] bcrypt total(ms):', Date.now() - T1, 'total(ms):', Date.now() - T0);

    if (!driver && !operator) {
      return res.status(404).json({ error: "Email does not exist" });
    }

    // both match, same profile: treat as Both
    if (driver && driverPasswordMatch && operator && operatorPasswordMatch) {
      if (driver.profileID !== operator.profileID) {
        return res.status(400).json({ error: "Conflict: Profile IDs do not match" });
      }
      return res.status(200).json({
        message: "Login successful",
        userType: "Both",
        userId: driver._id,
        driver,
        operator,
        // ✅ informational flags (do NOT block login)
        needVerification: !(driver.isVerified && operator.isVerified),
        isVerifiedDriver: !!driver.isVerified,
        isVerifiedOperator: !!operator.isVerified,
      });
    }

    if (driver && driverPasswordMatch) {
      return res.status(200).json({
        message: "Login successful",
        userType: "Driver",
        userId: driver._id,
        driver,
        // ✅ informational flag
        needVerification: !driver.isVerified,
        isVerifiedDriver: !!driver.isVerified,
      });
    }

    if (operator && operatorPasswordMatch) {
      return res.status(200).json({
        message: "Login successful",
        userType: "Operator",
        userId: operator._id,
        operator,
        // ✅ informational flag
        needVerification: !operator.isVerified,
        isVerifiedOperator: !!operator.isVerified,
      });
    }

    // if we got here, at least one account existed but password(s) didn’t match
    return res.status(400).json({ error: "Incorrect password" });

  } catch (error) {
    console.error("Driver login failed:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

module.exports = router;
