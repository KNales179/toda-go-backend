const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema({
  bookingId: String,
  passengerId: String,
  driverId: String,
  reportType: String,
  otherReport: String, 
  submittedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Report", ReportSchema);
