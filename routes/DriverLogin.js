// ✅ routes/DriverLogin.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const Driver = require("../models/Drivers");
const Operator = require("../models/Operator");

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    let driver = null;
    let operator = null;
    let driverPasswordMatch = false;
    let operatorPasswordMatch = false;

    // Try finding driver
    driver = await Driver.findOne({ email });
    if (driver) {
      driverPasswordMatch = await bcrypt.compare(password, driver.password || "");
    }

    // Try finding operator
    operator = await Operator.findOne({ email });
    if (operator) {
      operatorPasswordMatch = await bcrypt.compare(password, operator.password || "");
    }

    // Final decision

    if (!driver && !operator) {
      return res.status(404).json({ error: "Email does not exist" });
    }

    if (driver && driverPasswordMatch && operator && operatorPasswordMatch) {
      // Both match ➔ check profileID
      if (driver.profileID === operator.profileID) {
        return res.status(200).json({
          message: "Login successful",
          userType: "Both",
          userId: driver._id,
          driver: driver, // Include full driver data
        });
      } else {
        return res.status(400).json({ error: "Conflict: Profile IDs do not match" });
      }
    }

    if (driver && driverPasswordMatch) {
      return res.status(200).json({
        message: "Login successful",
        userType: "Driver",
        userId: driver._id,
        driver: driver, 
      });
    }

    if (operator && operatorPasswordMatch) {
      return res.status(200).json({
        message: "Login successful",
        userType: "Operator",
        userId: operator._id,
        operator: operator, // Include full operator data
      });
    }

    if ((driver && !driverPasswordMatch) || (operator && !operatorPasswordMatch)) {
      return res.status(400).json({ error: "Incorrect password" });
    }

    // Safety fallback
    res.status(400).json({ error: "Unable to login" });

  } catch (error) {
    console.error("Driver login failed:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

module.exports = router;
