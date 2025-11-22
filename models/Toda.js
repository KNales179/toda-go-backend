// models/Toda.js
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
    },
    longitude: {
      type: Number,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

// 🔹 Shape of a routed path (we'll store ORS result here)
const RouteShapeSchema = new mongoose.Schema(
  {
    // stored as [[lng, lat], [lng, lat], ...]
    coords: {
      type: [[Number]],
      default: [],
    },
    distanceMeters: {
      type: Number, // ORS summary.distance
    },
    durationSeconds: {
      type: Number, // ORS summary.duration
    },
  },
  { _id: false }
);

// 🔹 Final destination of a TODA line (terminal → final stop)
const FinalDestinationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true, // ex: "Dalahican"
    },
    latitude: {
      type: Number,
    },
    longitude: {
      type: Number,
    },
    // Main chosen route terminal→final
    mainRoute: {
      type: RouteShapeSchema,
      default: null,
    },
    // Optional alternative routes (other major variants)
    altRoutes: {
      type: [RouteShapeSchema],
      default: [],
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

    // 🔹 optional radius used for driver TODA-zone detection
    radiusMeters: {
      type: Number,
      default: 0, // 0 = use frontend default (e.g. 100m)
    },

    // list of along-the-way / nearby destinations
    servedDestinations: {
      type: [ServedDestinationSchema],
      default: [],
    },

    // 🔹 new: main endpoints this TODA line officially serves
    finalDestinations: {
      type: [FinalDestinationSchema],
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
