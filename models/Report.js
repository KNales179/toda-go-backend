const mongoose = require("mongoose");

const ReportSchema = new mongoose.Schema({
  bookingId: String,
  passengerId: String,
  driverId: String,
  reportType: String,     
  otherReport: String,    
  status: {
    type: String,
    enum: ["open", "in progress", "resolved", "dismissed"],
    default: "open",
  },
  resolutionNote: String,
  submittedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
});

module.exports = mongoose.model("Report", ReportSchema);
