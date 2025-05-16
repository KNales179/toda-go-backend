const mongoose = require('mongoose');

const BlockedRoadSchema = new mongoose.Schema({
  start: {
    lat: Number,
    lng: Number
  },
  end: {
    lat: Number,
    lng: Number
  },
  dateBlocked: {
    type: Date,
    default: Date.now
  },
  reason: {
    type: String,
    default: 'Temporary block'
  }
});

module.exports = mongoose.model('BlockedRoad', BlockedRoadSchema);
