const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.status(200).send('ok'));
app.get('/warmup', async (req, res) => {
  try { await mongoose.connection.db.admin().ping(); res.send('warmed'); }
  catch { res.status(500).send('warmup-failed'); }
});

app.get('/env-check', (req, res) => {
  res.json({
    has_SENDGRID_API_KEY: !!process.env.SENDGRID_API_KEY,
    starts_with_SG: (process.env.SENDGRID_API_KEY || '').startsWith('SG.'),
    from_email: process.env.SMTP_FROM_EMAIL,
    backend_base: process.env.BACKEND_BASE_URL
  });
});


// Routes
const passengerRoutes = require("./routes/Passengerauth");
const driverRoutes = require("./routes/Driverauth");
const passengerLoginRoutes = require("./routes/PassengerLogin"); 
const driverLoginRoutes = require("./routes/DriverLogin");
const AdminAuthRoutes = require('./routes/Adminauth');
const blockedRoadRoutes = require('./routes/BlockRoad');
const bookingRoute = require('./routes/Booking');
const driverStatusRoute = require('./routes/DriverStatusRoute');
const driverinfo = require('./routes/DriverInfo');
const passengerinfo = require("./routes/PassengerInfo");
const statsRoute = require('./routes/Stats');
const feedbackRoutes = require("./routes/FeedbackRoutes");
const reportsRoute = require('./routes/ReportsRoute');
const rideHistoryRoute = require("./routes/RideHistoryRoutes");
const orsRoute = require('./routes/orsRoute');
const geocodeRoute = require('./routes/geocodeRoute');

// Use routes
app.use("/api/auth/passenger", passengerRoutes);
app.use("/api/auth/driver", driverRoutes);
app.use("/api/login/passenger", passengerLoginRoutes);
app.use("/api/login/driver", driverLoginRoutes);
app.use('/api/admin', AdminAuthRoutes);
app.use('/api', blockedRoadRoutes);
app.use('/api', bookingRoute);
app.use('/api', driverStatusRoute);
app.use('/api', driverinfo);
app.use("/api", passengerinfo);
app.use('/api/stats', statsRoute);
app.use("/api/feedback", feedbackRoutes);
app.use('/api', reportsRoute);
app.use("/api", rideHistoryRoute);
app.use(orsRoute);
app.use(geocodeRoute);

// Static uploads
app.use("/uploads", express.static("uploads"));

// DB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ Connected to MongoDB"))
.catch((err) => console.error("❌ MongoDB connection failed:", err));


// Base route
app.get("/", (req, res) => {
  res.send("Welcome to the Toda-Go Backend!");
});

// Run server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://Localhost:${PORT}`);
});
