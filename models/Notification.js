const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    userType: { type: String, enum: ["passenger", "driver"], required: true, index: true },

    category: { type: String, enum: ["verification", "report", "feedback", "notice"], required: true },

    title: { type: String, required: true },
    message: { type: String, required: true },

    // state
    seenAt: { type: Date, default: null },
    readAt: { type: Date, default: null },

    // sender
    createdByAdminId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdByAdminName: { type: String, default: "Admin" },

    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", NotificationSchema);
