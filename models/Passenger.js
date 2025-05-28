const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const passengerSchema = new mongoose.Schema({
  citizen_id: {
    type: String, 
  },
  license_Id: {
    type: String,
  },
  firstName: { type: String, required: true },
  middleName: { type: String, required: true },
  lastName: { type: String, required: true },
  suffix: { type: String },
  gender: { type:String },
  birthday: { type: Date},
  birth_place: { type: String },
  age: { type: Number },
  address: { type: String },
  brgy_Id: { type: Number },
  contact: { type: String },
  civil_status: { type: String },
  profileImage: { type: String, default: "" },
  homeAddress: { type:String },

  // From original app
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
});

// 🔒 Hash password before save
passengerSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model("Passenger", passengerSchema);
