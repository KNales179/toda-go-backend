const mongoose = require("mongoose");

const FeedbackSchema = new mongoose.Schema({
  bookingId: String,
  passengerId: String,
  driverId: String,
  feedback: String,
  submittedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Feedback", FeedbackSchema);
