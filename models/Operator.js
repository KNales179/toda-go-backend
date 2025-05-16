// ✅ Operator.js (Fixed)
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const OperatorSchema = new mongoose.Schema({   // mongoose is already imported
  profileID: { type: String, required: true },
  email: { type: String, unique: true, sparse: true },
  password: { type: String},

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

  votersIDImage: { type: String, required: true },
  driversLicenseImage: { type: String },
  orcrImage: { type: String },
  selfieImage: { type: String },
}, { timestamps: true });

OperatorSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});


module.exports = mongoose.model("Operator", OperatorSchema);
