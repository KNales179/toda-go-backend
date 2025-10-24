// models/DriverStatus.js
const mongoose = require('mongoose');

const DriverStatusSchema = new mongoose.Schema({
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    required: true,
    unique: true, // Only one status per driver
  },

  isOnline: { type: Boolean, default: false },

  location: {
    latitude: Number,
    longitude: Number,
  },

  // ▶️ NEW: Capacity + Solo lock
  capacityTotal: { type: Number, enum: [4, 6], default: 4 },
  capacityUsed: { type: Number, default: 0 },
  lockedSolo: { type: Boolean, default: false },

  // (Optional helper for debugging/recovery)
  activeBookingIds: { type: [String], default: [] },

  updatedAt: { type: Date, default: Date.now },
});


module.exports = mongoose.model('DriverStatus', DriverStatusSchema);
