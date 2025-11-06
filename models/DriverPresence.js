// models/DriverPresence.js
const mongoose = require("mongoose");

const DriverPresenceSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
  },
  { timestamps: true }
);

DriverPresenceSchema.index({ driverId: 1, startAt: 1 });

module.exports = mongoose.model("DriverPresence", DriverPresenceSchema);
