// models/Task.js
const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    driverId: { type: String, required: true, index: true },

    sourceType: { type: String, enum: ["BOOKING", "PWAPP"], required: true },
    sourceId: { type: String, required: true, index: true }, // bookingId or pwAppId

    taskType: { type: String, enum: ["PICKUP", "DROPOFF"], required: true },

    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    place: { type: String, default: "" },

    dependsOnTaskId: { type: mongoose.Schema.Types.ObjectId, default: null },

    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "COMPLETED", "CANCELED"],
      default: "PENDING",
      index: true,
    },

    completedAt: { type: Date, default: null },

    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

TaskSchema.index({ driverId: 1, status: 1 });
TaskSchema.index({ sourceType: 1, sourceId: 1 });

module.exports = mongoose.model("Task", TaskSchema);
