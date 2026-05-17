// ✅ models/Drivers.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const DriverSchema = new mongoose.Schema(
  {
    profileID: { type: String, required: true },
    pushToken: { type: String, default: null },

    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },

    password: { type: String },

    // Email OTP verification status
    // false = registered but not email verified yet
    // true = email OTP verified
    isVerified: {
      type: Boolean,
      default: false,
    },

    emailOtpHash: {
      type: String,
      default: null,
    },

    emailOtpExpires: {
      type: Date,
      default: null,
    },

    emailOtpAttempts: {
      type: Number,
      default: 0,
    },

    emailOtpLastSentAt: {
      type: Date,
      default: null,
    },

    emailOtpResendCount: {
      type: Number,
      default: 0,
    },

    // Admin verification
    driverVerified: { type: Boolean, default: false },

    franchiseNumber: { type: String, required: true },
    todaName: { type: String, required: true, default: "Unassigned" },
    sector: {
      type: String,
      enum: ["East", "West", "North", "South", "Other"],
      required: true,
    },

    plateNumber: { type: String, default: "" },
    trikeColor: {
      type: String,
      enum: ["yellow", "green", ""],
      default: "",
    },

    driverFirstName: { type: String, required: true },
    driverMiddleName: { type: String, default: "" },
    driverLastName: { type: String, required: true },
    driverSuffix: { type: String, default: "" },
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
      enum: ["1-5 taon", "6-10 taon", "16-20 taon", "20 taon pataas"],
      required: true,
    },

    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },

    isLucenaVoter: { type: String, enum: ["Oo", "Hindi", ""], default: "" },
    votingLocation: { type: String, default: "" },

    // ✅ old fields kept optional so old database records do not break
    votersIDImage: { type: String },
    orcrImage: { type: String },
    votersIDImagePublicId: { type: String },
    orcrImagePublicId: { type: String },

    // ✅ new simplified registration still uses these
    driversLicenseImage: { type: String },
    selfieImage: { type: String },
    driversLicenseImagePublicId: { type: String },
    selfieImagePublicId: { type: String },

    capacity: {
      type: Number,
      min: 1,
      max: 6,
      default: 4,
      required: true,
    },

    driverVerification: {
      status: {
        type: String,
        enum: ["verify", "reject", "unverify"],
        default: "unverify",
      },
      reviewedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: null },
      reviewedByAdminId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
    },

    restriction: {
      isRestricted: { type: Boolean, default: false },
      type: { type: String, enum: ["ban", "suspend"], default: "ban" },
      reason: { type: String, default: "" },
      startAt: { type: Date, default: null },
      endAt: { type: Date, default: null },
      createdByAdminId: { type: mongoose.Schema.Types.ObjectId, default: null },
      updatedAt: { type: Date, default: null },
    },

    isPresident: { type: Boolean, default: false },
    todaPresName: { type: String, default: "" },
  },
  { timestamps: true }
);

DriverSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model("Driver", DriverSchema);