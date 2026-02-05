const mongoose = require("mongoose");

const SegmentSchema = new mongoose.Schema(
  {
    start: { type: String, required: true },   // "HH:mm"
    end: { type: String, required: true },     // "HH:mm"
    allowed: {
      type: String,
      enum: ["none", "yellow", "green", "both"],
      default: "none",
      required: true,
    },
  },
  { _id: false }
);

const DaySchema = new mongoose.Schema(
  {
    segments: { type: [SegmentSchema], default: [] },
  },
  { _id: false }
);

const WeeklySchema = new mongoose.Schema(
  {
    monday: { type: DaySchema, default: () => ({}) },
    tuesday: { type: DaySchema, default: () => ({}) },
    wednesday: { type: DaySchema, default: () => ({}) },
    thursday: { type: DaySchema, default: () => ({}) },
    friday: { type: DaySchema, default: () => ({}) },
    saturday: { type: DaySchema, default: () => ({}) },
    sunday: { type: DaySchema, default: () => ({}) },
  },
  { _id: false }
);

const TricycleScheduleConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "weekly", unique: true },
    weekly: { type: WeeklySchema, default: () => ({}) },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.TricycleScheduleConfig ||
  mongoose.model("TricycleScheduleConfig", TricycleScheduleConfigSchema);
