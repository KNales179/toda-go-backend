const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/mailer");
const { uploadMem, uploadBufferToCloudinary } = require("../utils/media");
const cloudinary = require("../utils/cloudinaryConfig");


function fullName(p) {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ');
}

function verifyEmailTemplate({ name, verifyUrl }) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <h2 style="margin:0 0 12px;color:#111">Hello ${name || 'Passenger'},</h2>
    <p style="margin:0 0 16px;color:#333;line-height:1.5">
      Please verify your TodaGo account by clicking the button below.
      This link expires in <strong>24 hours</strong>.
    </p>

    <p style="margin:24px 0">
      <a href="${verifyUrl}"
         style="display:inline-block;background:#1a73e8;color:#fff;text-decoration:none;
                padding:12px 18px;border-radius:8px;font-weight:600">
        Verify Email
      </a>
    </p>

    <p style="margin:16px 0 8px;color:#333">If the button doesn’t work, copy and paste this link:</p>
    <p style="margin:0;word-break:break-all">
      <a href="${verifyUrl}" style="color:#1a73e8">${verifyUrl}</a>
    </p>

    <hr style="margin:24px 0;border:none;border-top:1px solid #eee" />

    <p style="margin:0;color:#777;font-size:12px">
      You’re receiving this email because an account was created with this address.
      If this wasn’t you, you can safely ignore it.
    </p>
  </div>`;
}


// ---------- REGISTER ----------
router.post("/register-passenger", async (req, res) => {
  try {

    const { firstName, middleName, lastName, birthday, email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const exists = await Passenger.findOne({ email });
    if (exists) return res.status(400).json({ error: "Passenger already exists" });

    // Create & save first (guarantee _id); set isVerified
    const passenger = new Passenger({
      firstName,
      middleName,
      lastName,
      birthday,
      email,
      password,
      isVerified: false,
    });
    await passenger.save();

    // Build token & link
    const token = jwt.sign({ id: passenger._id }, process.env.JWT_SECRET, { expiresIn: "1d" });
    const verifyUrl = `${process.env.BACKEND_BASE_URL}/api/auth/passenger/verify-email?token=${encodeURIComponent(token)}`;

    // Send email (OBJECT shape)
    await sendMail({
      to: passenger.email,
      subject: "Verify your TodaGo Account",
      html: verifyEmailTemplate({
        name: fullName(passenger),
        verifyUrl,
      }),
      text: `Hello ${fullName(passenger) || 'Passenger'},\n\n` +
            `Please verify your TodaGo account (expires in 24 hours):\n${verifyUrl}\n\n` +
            `If you didn’t request this, you can ignore this email.`,
    });


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

    return res.send("✅ Email verified! You can now log in to the app.");
  } catch (e) {
    console.error("verify-email error:", e);
    return res.status(500).send("Server error");
  }
});

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
      html: verifyEmailTemplate({
        name: fullName(passenger),
        verifyUrl,
      }),
      text: `Hello ${fullName(passenger) || 'Passenger'},\n\n` +
            `Please verify your TodaGo account (expires in 24 hours):\n${verifyUrl}\n\n` +
            `If you didn’t request this, you can ignore this email.`,
    });


    return res.json({ message: "Verification email sent" });
  } catch (e) {
    console.error("resend-verification error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const p = await Passenger.findById(req.params.id);
    if (!p) return res.status(404).json({ message: "Passenger not found" });
    return res.json({ passenger: p });
  } catch (e) {
    console.error("get passenger error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/photo", uploadMem.single("profileImage"), async (req, res) => {
  try {
    const passengerId = req.params.id;
    const p = await Passenger.findById(passengerId);
    if (!p) return res.status(404).json({ message: "Passenger not found" });
    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded (profileImage)" });
    }

    // 🔍 debug logs (temporary)
    console.log("[PPhoto] id:", passengerId);
    console.log("[PPhoto] file:", {
      size: req.file.size,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });

    if (!req.file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ message: "Only image uploads are allowed" });
    }

    // delete old asset if exists (best-effort)
    if (p.profileImagePublicId) {
      try {
        await cloudinary.uploader.destroy(p.profileImagePublicId);
        console.log("[PPhoto] destroyed old:", p.profileImagePublicId);
      } catch (e) {
        console.warn("[PPhoto] destroy old failed:", e?.message || e);
      }
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: "toda-go/passengers",
      resource_type: "image",
      transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
    });

    // 🔍 debug log (temporary)
    console.log("[PPhoto] cloudinary result:", {
      secure_url: result.secure_url,
      public_id: result.public_id,
    });

    p.profileImage = result.secure_url;       // full https URL
    p.profileImagePublicId = result.public_id;
    await p.save();

    return res.status(200).json({ passenger: p, message: "Profile image updated!" });
  } catch (error) {
    console.error("passenger photo upload error:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
});


module.exports = router;
