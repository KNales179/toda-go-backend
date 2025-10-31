// ✅ models/Operator.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const OperatorSchema = new mongoose.Schema({
  profileID: { type: String, required: true },

  email: { type: String, unique: true, sparse: true },
  password: { type: String },
  isVerified: { type: Boolean, default: false }, // <— added to match your route

  franchiseNumber: { type: String, required: true },
  todaName: { type: String, required: true },
  sector: { type: String, enum: ["East", "West", "North", "South", "Other"], required: true },

  operatorFirstName: { type: String, required: true },
  operatorMiddleName: { type: String, required: true },
  operatorLastName: { type: String, required: true },
  operatorSuffix: { type: String },
  operatorName: { type: String, required: true },
  operatorBirthdate: { type: String, required: true },
  operatorPhone: { type: String, required: true },

  // 🖼 Cloudinary URLs
  votersIDImage: { type: String, required: true },
  driversLicenseImage: { type: String },
  orcrImage: { type: String },
  selfieImage: { type: String },

  // 🆔 Cloudinary public_ids (for deletion/replacement)
  votersIDImagePublicId: { type: String },
  driversLicenseImagePublicId: { type: String },
  orcrImagePublicId: { type: String },
  selfieImagePublicId: { type: String },

  // 🚕 kept in your route, so persist it here too
  capacity: { type: Number, min: 1, max: 6, default: 4, required: true },
}, { timestamps: true });

OperatorSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model("Operator", OperatorSchema);
