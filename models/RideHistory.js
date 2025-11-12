const mongoose = require("mongoose");

const RideHistorySchema = new mongoose.Schema(
  {
    bookingId: String,
    passengerId: String,

    // store ID internally for joins; do NOT expose in sanitized route
    driverId: String,

    // coordinates (kept)
    pickupLat: Number,
    pickupLng: Number,
    destinationLat: Number,
    destinationLng: Number,

    // ✅ human-friendly labels/names (prefer these in UI)
    pickupPlace: { type: String, default: null },
    pickupAddress: String,
    pickupLabel: String,
    pickupName: String,

    destinationPlace: { type: String, default: null },
    destinationAddress: String,
    destinationLabel: String,
    destinationName: String,

    // fares
    fare: Number,
    totalFare: Number,

    paymentMethod: String,
    notes: String,

    // ✅ booking meta
    bookingType: {
      type: String,
      enum: ["Classic", "Group", "Solo"], // Title Case for clean UI
      default: "Classic",
    },
    groupCount: { type: Number, default: 1 },

    // 👇 NEW audit trail for "Book for Someone Else"
    bookedFor: { type: Boolean, default: false },
    riderName: { type: String, default: null },
    riderPhone: { type: String, default: null },

    completedAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// quick helpers
RideHistorySchema.index({ passengerId: 1, completedAt: -1 });
RideHistorySchema.index({ driverId: 1, completedAt: -1 });
RideHistorySchema.index({ bookingId: 1 }, { unique: false });
RideHistorySchema.index({ bookedFor: 1 }); // optional analytics filter

module.exports = mongoose.model("RideHistory", RideHistorySchema);
