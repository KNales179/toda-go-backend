const mongoose = require("mongoose");

const FareConfigSchema = new mongoose.Schema(
  {
    // Regular / rumble fare (not from terminal)
    regular: {
      baseKm: {
        type: Number,
        default: 2, // first X km
        min: 0,
      },
      baseFare: {
        type: Number,
        default: 20, // ₱ for first baseKm
        min: 0,
      },
      addlPerKm: {
        type: Number,
        default: 5, // ₱ per succeeding km or fraction
        min: 0,
      },
      chargeMode: {
        type: String,
        enum: ["per_passenger", "per_trip"],
        default: "per_passenger",
      },
    },

    // Special / exclusive hire (from terminal / arkila)
    special: {
      baseKm: {
        type: Number,
        default: 2, // first X km
        min: 0,
      },
      baseFare: {
        type: Number,
        default: 60, // ₱ for first baseKm
        min: 0,
      },
      shortKm: {
        type: Number,
        default: 1, // special rule for short distance (e.g., 1 km)
        min: 0,
      },
      shortFare: {
        type: Number,
        default: 30, // ₱ if distance <= shortKm
        min: 0,
      },
      addlPerKm: {
        type: Number,
        default: 10, // ₱ per succeeding km or fraction
        min: 0,
      },
      chargeMode: {
        type: String,
        enum: ["per_passenger", "per_trip"],
        default: "per_trip",
      },
    },

    // Discounts (Senior, PWD, Student)
    discounts: {
      enabled: {
        type: Boolean,
        default: true,
      },
      percent: {
        type: Number,
        default: 20, 
        min: 0,
        max: 100,
      },
      appliesTo: {
        type: [String],
        default: ["senior", "pwd", "student"], // identifiers you’ll use in booking
      },
    },

    // Optional meta
    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin", // or whatever your admin model is called
    },
    lastUpdatedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Helper: always work with a single config document
FareConfigSchema.statics.getSingleton = async function () {
  const FareConfig = this;

  let config = await FareConfig.findOne({});
  if (!config) {
    config = await FareConfig.create({});
  }
  return config;
};

module.exports = mongoose.model("FareConfig", FareConfigSchema);
