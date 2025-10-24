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

    // Who
    passengerId: { type: String, required: true },
    driverId: { type: String, default: null },

    // Where
    pickupLat: Number,
    pickupLng: Number,
    destinationLat: Number,
    destinationLng: Number,

    // Fare & misc (pricing handled later by Admin—kept for compatibility)
    fare: Number,
    paymentMethod: String,
    notes: String,

    // Booking state
    status: {
      type: String,
      enum: ["pending", "accepted", "enroute", "completed", "canceled"],
      default: "pending",
    },

    // ▶️ NEW: Booking type + seat logic
    // CLASSIC (shareable, 1 seat), GROUP (shareable, 1..5 seats), SOLO (VIP, non-shareable, 1 seat)
    bookingType: {
      type: String,
      enum: ["CLASSIC", "GROUP", "SOLO"],
      default: "CLASSIC",
    },
    partySize: { type: Number, default: 1, min: 1, max: 5 },
    isShareable: { type: Boolean, default: true },
    reservedSeats: { type: Number, default: 1 },

    // Solo lock hint (set true when accepted if SOLO)
    driverLock: { type: Boolean, default: false },

    // Reservation timeout (after driver accepts; seats auto-release if not progressed)
    reservationExpiresAt: { type: Date, default: null },

    // Display
    passengerName: { type: String, default: "Passenger" },

    // Optional flags
    driverConfirmed: { type: Boolean, default: false }, // legacy compatibility
    cancelledBy: { type: String, default: "" },
  },
  { timestamps: true }
);

// Useful indexes
BookingSchema.index({ status: 1 });
BookingSchema.index({ driverId: 1 });
BookingSchema.index({ bookingType: 1 });
BookingSchema.index({ reservationExpiresAt: 1 });

module.exports = mongoose.model("Booking", BookingSchema);
