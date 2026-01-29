const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const passengerSchema = new mongoose.Schema({
  citizen_id: {
    type: String, 
  },
  firstName: { type: String, required: true },
  middleName: { type: String },
  lastName: { type: String, required: true },
  suffix: { type: String },
  gender: { type:String },
  birthday: { type: Date},
  birth_place: { type: String },
  age: { type: Number },
  address: { type: String },
  brgy_Id: { type: Number },
  contact: { type: String },
  phone: { type: String },           
  eContactName: { type: String },    
  eContactPhone: { type: String },   
  civil_status: { type: String },
  profileImage: { type: String },
  profileImagePublicId: { type: String },
  homeAddress: { type:String },
  pushToken: { type: String },
  discount: { type: Boolean, default: false },
  discountType: {
    type: String,
    enum: ["Student", "Senior Citizen", "PWD", null],
    default: null,
  },


  discountVerification: {
    type: {
      type: String,
      enum: ["Student", "Senior Citizen", "PWD"],
      default: null,
    },

    // Required only when type === "Student"
    schoolYear: {
      type: String, // example: "2025-2026"
      default: null,
    },

    // system computed
    validUntil: {
      type: Date,
      default: null,
    },

    // status lifecycle
    status: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },

    // evidence images stored in Cloudinary
    idFrontUrl: { type: String, default: null },
    idFrontPublicId: { type: String, default: null },

    idBackUrl: { type: String, default: null },
    idBackPublicId: { type: String, default: null },

    // admin will fill these later (not now, but schema-ready)
    submittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedByAdminId: { type: String, default: null },

    rejectionReason: { type: String, default: null },
  },

  // From original app
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  isVerified: { type: Boolean, default: false }
});

// 🔒 Hash password before save
passengerSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.model("Passenger", passengerSchema);
