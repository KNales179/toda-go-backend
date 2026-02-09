// ✅ models/Drivers.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const DriverSchema = new mongoose.Schema({
  profileID: { type: String, required: true },
  pushToken: { type: String, default: null },

  email: { type: String, unique: true, sparse: true },
  password: { type: String },
  isVerified: { type: Boolean, default: false },
  driverVerified: { type: Boolean, default: false },

  franchiseNumber: { type: String, required: true },
  todaName: { type: String, required: true, default: "Unassigned" },
  sector: { type: String, enum: ["East", "West", "North", "South", "Other"], required: true },
  plateNumber: { type: String, default: "" },

  driverFirstName: { type: String, required: true },
  driverMiddleName: { type: String, required: true },
  driverLastName: { type: String, required: true },
  driverSuffix: { type: String },
  driverName: { type: String, required: true },
  gender: { type: String },
  driverBirthdate: { type: String, required: true },
  driverPhone: { type: String, required: true },
  homeAddress: { type: String },
  licenseId: { type: String },
  gcashNumber: { type: String, default: "" },
  gcashQRUrl: { type: String, default: null },
  gcashQRPublicId: { type: String, default: null },

  experienceYears: {
    type: String,
    enum: ["1-5 taon", "6-10 taon", "16-20 taon", "20 taon pataas"], // keep your current set
    required: true
  },

  rating: { type: Number, default: 0 },
  ratingCount: { type: Number, default: 0 },

  isLucenaVoter: { type: String, enum: ["Oo", "Hindi"], required: true },
  votingLocation: { type: String },

  // 🔗 Cloudinary URLs
  votersIDImage: { type: String },
  driversLicenseImage: { type: String },
  orcrImage: { type: String },
  selfieImage: { type: String },

  // 🆔 Cloudinary public_ids (so you can delete/replace later)
  votersIDImagePublicId: { type: String },
  driversLicenseImagePublicId: { type: String },
  orcrImagePublicId: { type: String },
  selfieImagePublicId: { type: String },

  capacity: { type: Number, min: 1, max: 6, default: 4, required: true },

  driverVerification: {
    status: { type: String, enum: ["verify", "reject", "unverify"], default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    reviewedByAdminId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },

  restriction: {
    isRestricted: { type: Boolean, default: false },
    type: { type: String, enum: ["ban", "suspend"], default: "ban" }, // optional future-proof
    reason: { type: String, default: "" },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null }, // null = indefinite
    createdByAdminId: { type: mongoose.Schema.Types.ObjectId, default: null },
    updatedAt: { type: Date, default: null },
  },

  isPresident: { type: Boolean, default: false },
  todaPresName: { type: String, default: "" }, // TODA they govern



}, { timestamps: true });

DriverSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10); 
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model("Driver", DriverSchema);
