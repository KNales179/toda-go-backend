const express = require("express");
const router = express.Router();
const Feedback = require("../models/Feedback");
const Report = require("../models/Report");
const Driver = require("../models/Drivers");

// ✅ Submit feedback
router.post("/submit-feedback", async (req, res) => {
  const { bookingId, passengerId, driverId, feedback } = req.body;
  try {
    const newFeedback = new Feedback({
      bookingId,
      passengerId,
      driverId,
      feedback,
    });
    await newFeedback.save();
    res.status(200).json({ message: "Feedback submitted!" });
  } catch (err) {
    console.error("❌ Error saving feedback:", err);
    res.status(500).json({ message: "Server error while submitting feedback" });
  }
});

// ✅ Submit report
router.post("/submit-report", async (req, res) => {
  const { bookingId, passengerId, driverId, reportType, otherReport } = req.body;
  try {
    const newReport = new Report({
      bookingId,
      passengerId,
      driverId,
      reportType,
      otherReport,
    });
    await newReport.save();
    res.status(200).json({ message: "Report submitted!" });
  } catch (err) {
    console.error("❌ Error saving report:", err);
    res.status(500).json({ message: "Server error while submitting report" });
  }
});

router.post("/rate-driver", async (req, res) => {
  const { driverId, rating } = req.body;
  try {
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    // Compute new average rating
    driver.rating = ((driver.rating * driver.ratingCount) + rating) / (driver.ratingCount + 1);
    driver.ratingCount += 1;
    await driver.save();

    res.status(200).json({ message: "Driver rated successfully!", driver });
  } catch (err) {
    console.error("❌ Error submitting driver rating:", err);
    res.status(500).json({ message: "Server error while rating driver" });
  }
});

module.exports = router;
