// models/ChatMessage.js
const mongoose = require("mongoose");

const ChatMessageSchema = new mongoose.Schema(
  {
    bookingId: {
      type: Number, // our Booking.js uses number id
      required: true,
    },
    senderId: {
      type: String,
      required: true,
    },
    senderRole: {
      type: String,
      enum: ["passenger", "driver"],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true } // this gives us createdAt + updatedAt automatically
);

module.exports = mongoose.model("ChatMessage", ChatMessageSchema);
