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
  });
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(compression());

app.set("trust proxy", 1); 

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

  socket.on("sessions:subscribe", ({ passengerId, driverId, role }) => {
    try {
      const userId =
        role === "passenger" ? passengerId :
        role === "driver" ? driverId :
        null;

      if (!userId) return;

      socket.join(String(userId));
      console.log(`📥 socket ${socket.id} joined user room: ${userId}`);
    } catch (err) {
      console.error("❌ sessions:subscribe error:", err);
    }
  });

  socket.on("chat:join", ({ driverId, passengerId }) => {
    try {
      if (!driverId || !passengerId) return;
      const room = `chat:${driverId}:${passengerId}`;
      socket.join(room);
      console.log(`💬 socket ${socket.id} joined chat room: ${room}`);
    } catch (err) {
      console.error("❌ chat:join error:", err);
    }
  });

  socket.on("chat:leave", ({ driverId, passengerId }) => {
    try {
      if (!driverId || !passengerId) return;
      const room = `chat:${driverId}:${passengerId}`;
      socket.leave(room);
      console.log(`🚪 socket ${socket.id} left chat room: ${room}`);
    } catch (err) {
      console.error("❌ chat:leave error:", err);
    }
  });

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
const tasksRoute = require("./routes/TasksRoute");
const pwappRoute = require("./routes/pwAppRoute");
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
const warmup = require("./routes/warmup");
const cloudinary = require("./routes/cloudinaryPing");
const media = require("./routes/driverMedia");
const AdminUsers = require("./routes/AdminUsers");
const adminDashboard = require("./routes/AdminDashboard");
const adminStatsRoutes = require("./routes/adminstats");
const fareConfigRoutes = require("./routes/FareConfig");
const publicFareConfigRoutes = require("./routes/PublicFareConfig");
const adminTodaRoutes = require("./routes/adminTodaRoutes");
const debugLogRoutes = require("./routes/DebugLog");
const liveMonitorRoutes = require("./routes/liveMonitor");
const notificationRoutes = require("./routes/Notifications");
const appealRoutes = require("./routes/Appeals");
const presidentRoutes = require("./routes/PresidentRoute");
const fareCompute = require("./routes/fareCompute");
const debugProbeRoutes = require("./routes/DebugProbe");

// Mount routes AFTER io is attached
app.use("/api/auth/passenger", passengerRoutes);
app.use("/api/auth/driver", driverRoutes);
app.use("/api/login/passenger", passengerLoginRoutes);
app.use("/api/login/driver", driverLoginRoutes);
app.use("/api/admin", AdminAuthRoutes);
app.use("/api", blockedRoadRoutes);
app.use("/api", bookingRoute);
app.use("/api", driverStatusRoute);
app.use("/api", tasksRoute);
app.use("/api", pwappRoute);
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
app.use(warmup);
app.use("/api", cloudinary);
app.use("/api/driver", media);
app.use("/api", AdminUsers);
app.use("/api", adminDashboard);
app.use("/api", adminStatsRoutes); 
app.use("/api", fareConfigRoutes);
app.use("/api", publicFareConfigRoutes);
app.use("/api/admin", adminTodaRoutes);
app.use("/api", debugLogRoutes);
app.use("/api", liveMonitorRoutes);
app.use("/api", notificationRoutes)
app.use("/api/appeals", appealRoutes);
app.use("/api", presidentRoutes);
app.use("/api", fareCompute);
app.use("/api", debugProbeRoutes);

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
