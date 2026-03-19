// models/Admin.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const AdminSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },

    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      minlength: 3,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    role: {
      type: String,
      enum: ["super_admin", "admin"],
      default: "admin",
    },

    isActive: { type: Boolean, default: true },

    // 2FA
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, default: null, select: false },
    twoFactorVerifiedAt: { type: Date, default: null },
    mustSetup2FA: { type: Boolean, default: false },

    // optional later
    trustedDeviceEnabled: { type: Boolean, default: false },

    // audit/basic tracking
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    lastLoginUserAgent: { type: String, default: null },

    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

AdminSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

AdminSchema.methods.comparePassword = async function (plain) {
  return bcrypt.compare(plain, this.password);
};

AdminSchema.methods.toSafeObject = function () {
  return {
    _id: this._id,
    name: this.name,
    username: this.username,
    email: this.email,
    role: this.role,
    isActive: this.isActive,
    twoFactorEnabled: this.twoFactorEnabled,
    twoFactorVerifiedAt: this.twoFactorVerifiedAt,
    mustSetup2FA: this.mustSetup2FA,
    trustedDeviceEnabled: this.trustedDeviceEnabled,
    lastLoginAt: this.lastLoginAt,
    lastLoginIp: this.lastLoginIp,
    lastLoginUserAgent: this.lastLoginUserAgent,
    createdByAdminId: this.createdByAdminId,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model("Admin", AdminSchema);