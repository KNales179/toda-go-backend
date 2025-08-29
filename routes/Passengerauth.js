const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const upload = require("../middleware/upload");
const { sendMail } = require("../utils/mailer"); // expects sendMail({to, subject, html})

// ---------- REGISTER ----------
router.post("/register-passenger", async (req, res) => {
  try {
    const { firstName, middleName, lastName, birthday, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const exists = await Passenger.findOne({ email });
    if (exists) return res.status(400).json({ error: "Passenger already exists" });

    // create doc (Mongoose assigns _id immediately)
    const passenger = new Passenger({
      firstName,
      middleName,
      lastName,
      birthday,
      email,
      password,
      isVerified: false, // make sure this field exists in your schema
    });

    // build verification link
    const token = jwt.sign({ id: passenger._id }, process.env.JWT_SECRET, { expiresIn: "1d" });
    const verifyUrl = `${process.env.BACKEND_BASE_URL}/api/auth/passenger/verify-email?token=${encodeURIComponent(token)}`;

    // send email via SendGrid
    await sendMail({
      to: passenger.email,
      subject: "Verify your TodaGo Account",
      html: `
        <p>Hello ${passenger.firstName || "Passenger"},</p>
        <p>Please verify your account by clicking below (expires in 24 hours):</p>
        <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#1a73e8;color:#fff;border-radius:6px;text-decoration:none">Verify Email</a></p>
        <p>If the button doesn't work, copy and paste this URL:<br>${verifyUrl}</p>
      `,
    });

    await passenger.save();
    return res.status(201).json({ message: "Registered. Please check your email to verify." });
  } catch (error) {
    console.error("Registration failed:", error);
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

// ---------- VERIFY EMAIL ----------
router.get("/verify-email", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send("Missing token");

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(400).send("Invalid or expired verification link");
    }

    const passenger = await Passenger.findById(decoded.id);
    if (!passenger) return res.status(404).send("Account not found");

    if (passenger.isVerified) return res.send("Already verified. You can log in.");

    passenger.isVerified = true;
    await passenger.save();

    // You can res.redirect(...) to a pretty success page instead
    return res.send("✅ Email verified! You can now log in to the app.");
  } catch (e) {
    console.error("verify-email error:", e);
    return res.status(500).send("Server error");
  }
});

// ---------- LOGIN (block unverified) ----------
router.post("/login-passenger", async (req, res) => {
  try {
    const { email, password } = req.body;

    const passenger = await Passenger.findOne({ email });
    if (!passenger) return res.status(400).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, passenger.password || "");
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });

    if (!passenger.isVerified) {
      return res.status(403).json({ error: "Email not verified", needVerification: true });
    }

    // issue your normal token/session
    const payload = { id: passenger.id, email: passenger.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "1h" });

    return res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

// ---------- OPTIONAL: resend verification ----------
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const passenger = await Passenger.findOne({ email });
    if (!passenger) return res.status(404).json({ message: "No account found" });
    if (passenger.isVerified) return res.status(200).json({ message: "Already verified" });

    const token = jwt.sign({ id: passenger._id }, process.env.JWT_SECRET, { expiresIn: "1d" });
    const verifyUrl = `${process.env.BACKEND_BASE_URL}/api/auth/passenger/verify-email?token=${encodeURIComponent(token)}`;

    await sendMail({
      to: passenger.email,
      subject: "Verify your TodaGo Account",
      html: `<p>Click to verify: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
    });

    return res.json({ message: "Verification email sent" });
  } catch (e) {
    console.error("resend-verification error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------- PROFILE IMAGE (unchanged) ----------
router.patch("/:id/update-profile-image", upload.single("profileImage"), async (req, res) => {
  try {
    const passengerId = req.params.id;
    const passenger = await Passenger.findById(passengerId);
    if (!passenger) return res.status(404).json({ message: "Passenger not found" });
    if (!req.file) return res.status(400).json({ message: "No image uploaded." });

    passenger.profileImage = req.file.path;
    await passenger.save();

    return res.status(200).json({ passenger, message: "Profile image updated!" });
  } catch (error) {
    console.error("update-profile-image error:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
