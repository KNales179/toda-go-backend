const mongoose = require("mongoose");

const ServedDestinationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true, // ex: "Pacific Mall", "SM Lucena"
      trim: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const TodaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true, // ex: "San Roque TODA"
      trim: true,
    },

    // main TODA terminal location
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },

    // display-only address info
    street: {
      type: String,
      trim: true,
    },
    barangay: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
      default: "Lucena City",
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    // list of allowed routes / destinations this TODA serves
    servedDestinations: {
      type: [ServedDestinationSchema],
      default: [],
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(doc, ret) {
        // so frontend can keep using `t.id`
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

module.exports = mongoose.model("Toda", TodaSchema);
