// ✅ Driver.js (Fixed)
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const DriverSchema = new mongoose.Schema({
  profileID: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  password: { type: String },

  franchiseNumber: { type: String, required: true },
  todaName: { type: String, required: true },
  sector: { type: String, enum: ["East", "West", "North", "South", "Other"], required: true },

  driverFirstName: { type: String, required: true },
  driverMiddleName: { type: String, required: true },
  driverLastName: { type: String, required: true },
  driverSuffix: { type: String },
  driverName: { type: String, required: true },
  gender: { type:String },
  driverBirthdate: { type: String, required: true },
  driverPhone: { type: String, required: true },
  homeAddress: { type:String },

  experienceYears: { type: String, enum: ["1-5 taon", "6-10 taon", "16-20 taon", "20 taon pataas"], required: true },
  isLucenaVoter: { type: String, enum: ["Oo", "Hindi"], required: true },
  votingLocation: { type: String },

  votersIDImage: { type: String },
  driversLicenseImage: { type: String },
  orcrImage: { type: String },
  selfieImage: { type: String },
}, { timestamps: true });

DriverSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model("Driver", DriverSchema);
