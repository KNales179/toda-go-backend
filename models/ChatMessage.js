// models/ChatMessage.js
const mongoose = require("mongoose");

const ChatMessageSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, index: true },
    passengerId: { type: String, required: true, index: true },

    bookingId: { type: Number, default: null },

    senderId: { type: String, required: true },
    senderRole: {
      type: String,
      enum: ["passenger", "driver"],
      required: true,
    },

    recipientId: { type: String, required: true },
    recipientRole: {
      type: String,
      enum: ["passenger", "driver"],
      required: true,
    },
    messageType: { type: String, enum: ["text", "image"], default: "text" },
    message: {
      type: String,
      default: "",
      trim: true,
    },
    imageUrl: { type: String, default: null },
    imagePublicId: { type: String, default: null },

    delivered: { type: Boolean, default: false },
    deliveredAt: { type: Date, default: null },

    seen: { type: Boolean, default: false },
    seenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Fast pair chat lookup
ChatMessageSchema.index({ driverId: 1, passengerId: 1, createdAt: 1 });

// Fast unread lookup per recipient
ChatMessageSchema.index({ recipientId: 1, recipientRole: 1, seen: 1, createdAt: -1 });

module.exports = mongoose.model("ChatMessage", ChatMessageSchema);