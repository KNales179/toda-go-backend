// models/DriverMeter.js
const mongoose = require("mongoose");

const DriverMeterSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, unique: true, index: true },

    totalMeters: { type: Number, default: 0 },

    lastLat: { type: Number, default: null },
    lastLng: { type: Number, default: null },
    lastUpdatedAt: { type: Date, default: null },

    sessionId: { type: String, default: () => `S-${Date.now()}` },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DriverMeter", DriverMeterSchema);
