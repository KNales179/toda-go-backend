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

    // "Book for someone else"
    bookedFor: { type: Boolean, default: false },     // true if rider != account owner
    riderName: { type: String, default: "" },         // visible to driver if bookedFor=true
    riderPhone: { type: String, default: "" },        // optional but recommended

    // Where
    pickupLat: Number,
    pickupLng: Number,
    destinationLat: Number,
    destinationLng: Number,
    pickupPlace: { type: String, default: null },
    destinationPlace: { type: String, default: null },

    // Fare & misc
    fare: Number,
    paymentMethod: String,
    notes: String,

    // Booking state
    status: {
      type: String,
      enum: ["pending", "accepted", "enroute", "completed", "canceled"],
      default: "pending",
    },

    // Types / seats
    bookingType: {
      type: String,
      enum: ["CLASSIC", "GROUP", "SOLO"],
      default: "CLASSIC",
    },
    partySize: { type: Number, default: 1, min: 1, max: 5 },
    isShareable: { type: Boolean, default: true },
    reservedSeats: { type: Number, default: 1 },

    // Matching / lock
    driverLock: { type: Boolean, default: false },
    reservationExpiresAt: { type: Date, default: null },

    // Labels
    passengerName: { type: String, default: "Passenger" },

    // Lifecycle timestamps/flags
    driverConfirmed: { type: Boolean, default: false },
    cancelledBy: { type: String, default: "" },
    acceptedAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    // Payments
    paymentStatus: {
      type: String,
      enum: ["none", "awaiting", "paid", "failed"],
      default: "none",
    },
    driverPayment: {
      number: { type: String, default: "" },
      qrUrl: { type: String, default: null },
      qrPublicId: { type: String, default: null },
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
BookingSchema.index({ bookedFor: 1 }); // quick filter for driver UI if needed

module.exports = mongoose.model("Booking", BookingSchema);
