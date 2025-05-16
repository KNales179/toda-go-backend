const mongoose = require('mongoose');

const DriverStatusSchema = new mongoose.Schema({
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    required: true,
    unique: true, // Only one status per driver
  },
  isOnline: {
    type: Boolean,
    default: false,
  },
  location: {
    latitude: Number,
    longitude: Number,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  }
});

module.exports = mongoose.model('DriverStatus', DriverStatusSchema);
