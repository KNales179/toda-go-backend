// models/Bookings.js
const mongoose = require("mongoose");

const BookingSchema = new mongoose.Schema(
  {
    bookingId: {
      type: String,
      default: () =>
        `TODA-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      unique: true,
    },
    passengerId: { type: String, required: true },
    driverId: { type: String, default: null },
    pickupLat: Number,
    pickupLng: Number,
    destinationLat: Number,
    destinationLng: Number,

    pickupPlace: { type: String, default: null },
    destinationPlace: { type: String, default: null },
    fare: Number,
    paymentMethod: String,
    notes: String,
    status: {
      type: String,
      enum: ["pending", "accepted", "enroute", "completed", "canceled"],
      default: "pending",
    },
    bookingType: {
      type: String,
      enum: ["CLASSIC", "GROUP", "SOLO"],
      default: "CLASSIC",
    },
    partySize: { type: Number, default: 1, min: 1, max: 5 },
    isShareable: { type: Boolean, default: true },
    reservedSeats: { type: Number, default: 1 },
    driverLock: { type: Boolean, default: false },
    reservationExpiresAt: { type: Date, default: null },
    passengerName: { type: String, default: "Passenger" },
    driverConfirmed: { type: Boolean, default: false }, 
    cancelledBy: { type: String, default: "" },

    paymentStatus: {
      type: String,
      enum: ["none", "awaiting", "paid", "failed"],
      default: "none",
    },
    driverPayment: {
      number: { type: String, default: "" },      
      qrUrl: { type: String, default: null },     
      qrPublicId: { type: String, default: null } 
    },

  },
  { timestamps: true }
);

// Useful indexes
BookingSchema.index({ status: 1 });
BookingSchema.index({ driverId: 1 });
BookingSchema.index({ bookingType: 1 });
BookingSchema.index({ reservationExpiresAt: 1 });
BookingSchema.index({ paymentStatus: 1 });


module.exports = mongoose.model("Booking", BookingSchema);
