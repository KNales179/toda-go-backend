// models/ChatMessage.js
const mongoose = require("mongoose");

const ChatMessageSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true },
    passengerId: { type: String, required: true },
    bookingId: { type: Number }, // optional: tag which booking this was from
    senderId: { type: String, required: true },
    senderRole: { type: String, enum: ["passenger", "driver"], required: true },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

// helpful index for fast lookups
ChatMessageSchema.index({ driverId: 1, passengerId: 1, createdAt: 1 });

module.exports = mongoose.model("ChatMessage", ChatMessageSchema);
