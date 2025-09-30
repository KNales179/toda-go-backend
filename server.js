// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const { Server } = require("socket.io");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ---------- Core middleware ----------
app.use(cors({
  origin: [
    // Adjust as needed for dev devices / Metro Web / production
    "*",
  ],
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// ---------- Health ----------
app.get('/health', (req, res) => res.status(200).send('ok'));
app.get('/warmup', async (req, res) => {
  try { await mongoose.connection.db.admin().ping(); res.send('warmed'); }
  catch { res.status(500).send('warmup-failed'); }
});

// ---------- Routes ----------
const passengerRoutes     = require("./routes/Passengerauth");
const driverRoutes        = require("./routes/Driverauth");
const passengerLoginRoutes= require("./routes/PassengerLogin"); 
const driverLoginRoutes   = require("./routes/DriverLogin");
const AdminAuthRoutes     = require('./routes/Adminauth');
const blockedRoadRoutes   = require('./routes/BlockRoad');
const bookingRoute        = require('./routes/Booking');
const driverStatusRoute   = require('./routes/DriverStatusRoute');
const driverinfo          = require('./routes/DriverInfo');
const passengerinfo       = require("./routes/PassengerInfo");
const statsRoute          = require('./routes/Stats');
const feedbackRoutes      = require("./routes/FeedbackRoutes");
const reportsRoute        = require('./routes/ReportsRoute');
const rideHistoryRoute    = require("./routes/RideHistoryRoutes");
const orsRoute            = require('./routes/orsRoute');
const geocodeRoute        = require('./routes/geocodeRoute');
const chatRoutes          = require("./routes/Chat");

// Static uploads
app.use("/uploads", express.static("uploads"));

// Mount routes
app.use("/api/auth/passenger", passengerRoutes);
app.use("/api/auth/driver",    driverRoutes);
app.use("/api/login/passenger", passengerLoginRoutes);
app.use("/api/login/driver",    driverLoginRoutes);
app.use('/api/admin',           AdminAuthRoutes);
app.use('/api',                 blockedRoadRoutes);
app.use('/api',                 bookingRoute);
app.use('/api',                 driverStatusRoute);
app.use('/api',                 driverinfo);
app.use("/api",                 passengerinfo);
app.use('/api/stats',           statsRoute);
app.use("/api/feedback",        feedbackRoutes);
app.use('/api',                 reportsRoute);
app.use("/api",                 rideHistoryRoute);
app.use(orsRoute);
app.use(geocodeRoute);

// We will attach io BEFORE mounting chat so routes/Chat.js can use req.app.get('io')
const server = http.createServer(app);

// ---------- Socket.IO ----------
const io = new Server(server, {
  cors: {
    origin: "*",        // tighten for production if you want
    methods: ["GET", "POST"],
  },
});

// Make io available to every route via req.app.get('io')
app.set("io", io);

// Optional: simple presence/rooms strategy
io.on("connection", (socket) => {
  // You can pass ?role=driver&userId=abc on connect to auto-join user rooms:
  // const { role, userId } = socket.handshake.query;
  // if (role && userId) socket.join(`${role}:${userId}`);

  // Or just log connections
  // console.log("🔌 socket connected:", socket.id);

  socket.on("disconnect", () => {
    // console.log("🔌 socket disconnected:", socket.id);
  });
});

// Mount chat routes AFTER io is set on app
app.use("/api/chat", chatRoutes);

// ---------- DB ----------
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ Connected to MongoDB"))
.catch((err) => console.error("❌ MongoDB connection failed:", err));

// Misc env probe
app.get('/__env-mail', (req, res) => {
  res.json({
    has_SENDGRID_API_KEY: !!process.env.SENDGRID_API_KEY,
    starts_with_SG: (process.env.SENDGRID_API_KEY || '').startsWith('SG.'),
    SMTP_FROM_EMAIL: process.env.SMTP_FROM_EMAIL ? 'set' : 'missing',
    SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || '(none)',
  });
});

// ---------- Start ----------
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
