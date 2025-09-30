// models/Bookings.js
const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema({
  bookingId: {
    type: String,
    default: () => `TODA-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    unique: true,
  },
  passengerId: { type: String, required: true },
  driverId: { type: String, default: null },
  pickupLat: Number,
  pickupLng: Number,
  destinationLat: Number,
  destinationLng: Number,
  fare: Number,
  paymentMethod: String,
  notes: String,
  status: { type: String, default: "pending" },
}, { timestamps: true });

module.exports = mongoose.model("Booking", BookingSchema);
