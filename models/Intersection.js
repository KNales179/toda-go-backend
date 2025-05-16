const mongoose = require('mongoose');

const IntersectionSchema = new mongoose.Schema({
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  roadNames: { type: [String], required: true } // example: ["Quezon Ave", "Cabana St"]
}, { timestamps: true });

module.exports = mongoose.model('Intersection', IntersectionSchema);
