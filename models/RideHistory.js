const mongoose = require("mongoose");

const RideHistorySchema = new mongoose.Schema({
  bookingId: String,
  passengerId: String,
  driverId: String,
  pickupLat: Number,
  pickupLng: Number,
  destinationLat: Number,
  destinationLng: Number,
  fare: Number,
  paymentMethod: String,
  notes: String,
  completedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("RideHistory", RideHistorySchema);
