// models/RestrictionLog.js
const mongoose = require("mongoose");

const RestrictionLogSchema = new mongoose.Schema(
  {
    userType: { type: String, enum: ["driver", "passenger"], required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },

    action: { type: String, enum: ["restrict", "unrestrict"], required: true },

    restrictionType: { type: String, enum: ["ban", "suspend"], default: "ban" },
    reason: { type: String, default: "" },

    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },

    createdByAdminId: { type: mongoose.Schema.Types.ObjectId, default: null },
    createdByAdminName: { type: String, default: "Admin" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("RestrictionLog", RestrictionLogSchema);
