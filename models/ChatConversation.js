const mongoose = require("mongoose");

const ChatConversationSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, index: true },
    passengerId: { type: String, required: true, index: true },

    latestBookingId: { type: Number, default: null },

    connectedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },

    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

ChatConversationSchema.index(
  { driverId: 1, passengerId: 1 },
  { unique: true }
);

module.exports = mongoose.model("ChatConversation", ChatConversationSchema);