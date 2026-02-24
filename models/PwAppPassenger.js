// models/PwAppPassenger.js
const mongoose = require("mongoose");

const PwAppPassengerSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, index: true },

    passengerType: {
      type: String,
      enum: ["REGULAR", "STUDENT", "PWD", "SENIOR"],
      default: "REGULAR",
    },
    note: { type: String, default: "" },

    pickupLat: { type: Number, required: true },
    pickupLng: { type: Number, required: true },
    pickupPlace: { type: String, default: "" },

    startMeterMeters: { type: Number, required: true },
    endMeterMeters: { type: Number, default: null },

    distanceMeters: { type: Number, default: null },
    computedFare: { type: Number, default: null },

    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED", "CANCELED"],
      default: "ACTIVE",
      index: true,
    },

    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

PwAppPassengerSchema.index({ driverId: 1, status: 1 });

module.exports = mongoose.model("PwAppPassenger", PwAppPassengerSchema);
