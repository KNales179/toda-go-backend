// models/Appeal.js
const mongoose = require("mongoose");

const AppealSchema = new mongoose.Schema(
  {
    userType: {
      type: String,
      enum: ["passenger", "driver"],
      required: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    restrictionType: {
      type: String,
      enum: ["ban", "suspend"],
      default: "ban",
    },

    restrictionReason: {
      type: String,
      default: null,
    },

    appealMessage: {
      type: String,
      required: true,
      maxlength: 1000,
    },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    adminNotes: {
      type: String,
      default: null,
    },

    handledByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    handledAt: {
      type: Date,
      default: null,
    },

    restrictionStartAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appeal", AppealSchema);
