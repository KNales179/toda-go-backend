// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const compression = require("compression");
const http = require("http");
const { Server } = require("socket.io");
const dns = require("dns");

dotenv.config();

// Prefer IPv4 to avoid slow IPv6 DNS on some hosts
try { dns.setDefaultResultOrder("ipv4first"); } catch {}

const app = express();
const PORT = process.env.PORT || 5000;

// ⏱ Request timing (put this BEFORE routes)
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`[RT] ${req.method} ${req.originalUrl} -> ${res.statusCode} in ${ms.toFixed(1)}ms`);
  });
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(compression());

// Health & warmup
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get('/warmup', async (req, res) => {
  try {
    if (!mongoose.connection.readyState) {
      return res.status(202).send('starting'); // 0=disconnected, 2=connecting
    }
    await mongoose.connection.db.admin().ping();
    res.send('warmed');
  } catch {
    res.status(202).send('warming');
  }
});


// --- Socket.IO setup ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Attach io to req for use in routes
app.use((req, res, next) => {
  req.io = io;
  next();
});

io.on("connection", (socket) => {
  console.log("🔌 socket connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("🔌 socket disconnected:", socket.id);
  });
});

// --- Routes ---
const passengerRoutes = require("./routes/Passengerauth");
const driverRoutes = require("./routes/Driverauth");
const passengerLoginRoutes = require("./routes/PassengerLogin");
const driverLoginRoutes = require("./routes/DriverLogin");
const AdminAuthRoutes = require("./routes/Adminauth");
const blockedRoadRoutes = require("./routes/BlockRoad");
const bookingRoute = require("./routes/Booking");
const driverStatusRoute = require("./routes/DriverStatusRoute");
const driverinfo = require("./routes/DriverInfo");
const passengerinfo = require("./routes/PassengerInfo");
const statsRoute = require("./routes/Stats");
const feedbackRoutes = require("./routes/FeedbackRoutes");
const reportsRoute = require("./routes/ReportsRoute");
const rideHistoryRoute = require("./routes/RideHistoryRoutes");
const orsRoute = require("./routes/orsRoute");
const geocodeRoute = require("./routes/geocodeRoute");
const chatRoutes = require("./routes/Chat");
const placesRoute = require("./routes/placesRoute");

// Mount routes AFTER io is attached
app.use("/api/auth/passenger", passengerRoutes);
app.use("/api/auth/driver", driverRoutes);
app.use("/api/login/passenger", passengerLoginRoutes);
app.use("/api/login/driver", driverLoginRoutes);
app.use("/api/admin", AdminAuthRoutes);
app.use("/api", blockedRoadRoutes);
app.use("/api", bookingRoute);
app.use("/api", driverStatusRoute);
app.use("/api", driverinfo);
app.use("/api", passengerinfo);
app.use("/api/stats", statsRoute);
app.use("/api/feedback", feedbackRoutes);
app.use("/api", reportsRoute);
app.use("/api", rideHistoryRoute);
app.use(orsRoute);
app.use(geocodeRoute);
app.use("/api/chat", chatRoutes);
app.use(placesRoute);

// Static uploads
app.use("/uploads", express.static("uploads"));

// --- DB Connection (single, at startup) ---
mongoose.set("strictQuery", true);
mongoose.set("autoIndex", false);
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000, // faster fail on cold DB
    socketTimeoutMS: 20000,
    maxPoolSize: 10,
    minPoolSize: 1,
  })
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ MongoDB connection failed:", err));

// --- Process-level error logs (handy during slow/cold starts) ---
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

// Run server (use `server.listen`, not app.listen!)
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
