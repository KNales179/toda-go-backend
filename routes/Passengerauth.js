const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const { uploadMem, uploadBufferToCloudinary } = require("../utils/media");
const cloudinary = require("../utils/cloudinaryConfig");

const sendEmailOtp = require("../utils/sendEmailOtp");
const {
  generateEmailOtp,
  hashEmailOtp,
  getEmailOtpExpiry,
  canResendOtp,
} = require("../utils/emailOtpUtils");

function fullName(p) {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" ");
}

// ---------- REGISTER ----------
router.post("/register-passenger", uploadMem.single("profileImage"), async (req, res) => {
  try {
    const {
      firstName,
      middleName,
      lastName,
      suffix,
      birthday,
      phone,
      email,
      password,
    } = req.body;

    const cleanEmail = String(email || "").toLowerCase().trim();

    if (!firstName || !lastName || !birthday || !phone || !cleanEmail || !password) {
      return res.status(400).json({
        success: false,
        error: "First name, last name, birthday, phone, email, and password are required.",
      });
    }

    const exists = await Passenger.findOne({ email: cleanEmail });
    if (exists) {
      return res.status(400).json({
        success: false,
        error: "Passenger already exists.",
      });
    }

    let profileImage = "";
    let profileImagePublicId = "";

    if (req.file) {
      if (!req.file.mimetype?.startsWith("image/")) {
        return res.status(400).json({
          success: false,
          error: "Only image uploads are allowed for profile image.",
        });
      }

      const uploaded = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "toda-go/passengers",
        resource_type: "image",
        transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
      });

      profileImage = uploaded.secure_url;
      profileImagePublicId = uploaded.public_id;
    }

    const otp = generateEmailOtp();

    const passenger = new Passenger({
      firstName: String(firstName).trim(),
      middleName: String(middleName || "").trim(),
      lastName: String(lastName).trim(),
      suffix: String(suffix || "").trim(),
      birthday,
      phone: String(phone).trim(),
      contact: String(phone).trim(),
      email: cleanEmail,
      password,

      profileImage,
      profileImagePublicId,

      isVerified: false,
      emailOtpHash: hashEmailOtp(otp),
      emailOtpExpires: getEmailOtpExpiry(),
      emailOtpAttempts: 0,
      emailOtpLastSentAt: new Date(),
      emailOtpResendCount: 0,
    });

    await passenger.save();

    try {
      await sendEmailOtp({
        to: passenger.email,
        otp,
        name: fullName(passenger) || passenger.firstName,
      });
    } catch (emailError) {
      console.error("❌ OTP email send failed:", emailError);

      return res.status(503).json({
        success: false,
        needEmailVerification: true,
        email: passenger.email,
        message:
          "Account was created, but we could not send the verification code right now. Please try resending the code later.",
      });
    }

    return res.status(201).json({
      success: true,
      needEmailVerification: true,
      message: "Registration successful. Please verify your email using the code sent to your email.",
      email: passenger.email,
    });
  } catch (error) {
    console.error("Registration failed:", error);
    return res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    });
  }
});

// ---------- VERIFY EMAIL OTP ----------
router.post("/verify-email-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const cleanEmail = String(email || "").toLowerCase().trim();
    const cleanOtp = String(otp || "").trim();

    if (!cleanEmail || !cleanOtp) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required.",
      });
    }

    if (!/^\d{6}$/.test(cleanOtp)) {
      return res.status(400).json({
        success: false,
        message: "Verification code must be 6 digits.",
      });
    }

    const passenger = await Passenger.findOne({ email: cleanEmail });

    if (!passenger) {
      return res.status(404).json({
        success: false,
        message: "Passenger account not found.",
      });
    }

    if (passenger.isVerified) {
      return res.status(200).json({
        success: true,
        message: "Email is already verified.",
      });
    }

    if (!passenger.emailOtpHash || !passenger.emailOtpExpires) {
      return res.status(400).json({
        success: false,
        message: "No verification code found. Please request a new code.",
      });
    }

    if (new Date() > new Date(passenger.emailOtpExpires)) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired. Please request a new code.",
      });
    }

    if (passenger.emailOtpAttempts >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many incorrect attempts. Please request a new code.",
      });
    }

    const hashedInputOtp = hashEmailOtp(cleanOtp);

    if (hashedInputOtp !== passenger.emailOtpHash) {
      passenger.emailOtpAttempts += 1;
      await passenger.save();

      return res.status(400).json({
        success: false,
        message: "Invalid verification code.",
        attemptsLeft: Math.max(0, 5 - passenger.emailOtpAttempts),
      });
    }

    passenger.isVerified = true;
    passenger.emailOtpHash = null;
    passenger.emailOtpExpires = null;
    passenger.emailOtpAttempts = 0;
    passenger.emailOtpLastSentAt = null;
    passenger.emailOtpResendCount = 0;

    await passenger.save();

    return res.status(200).json({
      success: true,
      message: "Email verified successfully. You can now log in.",
    });
  } catch (error) {
    console.error("❌ verify-email-otp error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error while verifying email.",
    });
  }
});

// ---------- RESEND EMAIL OTP ----------
router.post("/resend-email-otp", async (req, res) => {
  try {
    const { email } = req.body;

    const cleanEmail = String(email || "").toLowerCase().trim();

    if (!cleanEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const passenger = await Passenger.findOne({ email: cleanEmail });

    if (!passenger) {
      return res.status(404).json({
        success: false,
        message: "Passenger account not found.",
      });
    }

    if (passenger.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified.",
      });
    }

    if (!canResendOtp(passenger.emailOtpLastSentAt)) {
      return res.status(429).json({
        success: false,
        message: "Please wait 60 seconds before requesting another code.",
      });
    }

    if (passenger.emailOtpResendCount >= 3) {
      return res.status(429).json({
        success: false,
        message: "Maximum resend limit reached. Please try again later.",
      });
    }

    const newOtp = generateEmailOtp();

    passenger.emailOtpHash = hashEmailOtp(newOtp);
    passenger.emailOtpExpires = getEmailOtpExpiry();
    passenger.emailOtpAttempts = 0;
    passenger.emailOtpLastSentAt = new Date();
    passenger.emailOtpResendCount += 1;

    await passenger.save();

    try {
      await sendEmailOtp({
        to: passenger.email,
        otp: newOtp,
        name: fullName(passenger) || passenger.firstName,
      });
    } catch (emailError) {
      console.error("❌ resend OTP email failed:", emailError);

      return res.status(503).json({
        success: false,
        message:
          "We could not send a new verification code right now. Please try again later.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "A new verification code has been sent to your email.",
    });
  } catch (error) {
    console.error("❌ resend-email-otp error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to resend verification code. Please try again later.",
    });
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

    if (!p) {
      return res.status(404).json({ message: "Passenger not found" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded (profileImage)" });
    }

    if (!req.file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ message: "Only image uploads are allowed" });
    }

    if (p.profileImagePublicId) {
      try {
        await cloudinary.uploader.destroy(p.profileImagePublicId);
      } catch (e) {
        console.warn("[PPhoto] destroy old failed:", e?.message || e);
      }
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder: "toda-go/passengers",
      resource_type: "image",
      transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
    });

    p.profileImage = result.secure_url;
    p.profileImagePublicId = result.public_id;

    await p.save();

    return res.status(200).json({
      passenger: p,
      message: "Profile image updated!",
    });
  } catch (error) {
    console.error("passenger photo upload error:", error);

    return res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

module.exports = router;