const express = require("express");
const router = express.Router();
const Driver = require("../models/Drivers");   // ← your file name
const Operator = require("../models/Operator");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/mailer");

// Cloudinary + Multer (memory) + streamifier
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../utils/cloudinaryConfig");

// Use memory storage so we can stream buffers directly to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// base URL helper (Render / local)
function getBaseUrl(req) {
  return (
    process.env.BACKEND_BASE_URL ||
    `${(req.headers["x-forwarded-proto"] || req.protocol)}://${req.get("host")}`
  );
}

// stream buffer → Cloudinary
function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const up = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result); // { secure_url, public_id, ... }
    });
    streamifier.createReadStream(buffer).pipe(up);
  });
}

// POST /api/auth/driver/register-driver
router.post(
  "/register-driver",
  upload.fields([
    { name: "selfie", maxCount: 1 },
    { name: "votersIDImage", maxCount: 1 },
    { name: "driversLicenseImage", maxCount: 1 },
    { name: "orcrImage", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        role,
        driverEmail, driverPassword,
        operatorEmail, operatorPassword,
        franchiseNumber, todaName, sector,
        operatorFirstName, operatorMiddleName, operatorLastName, operatorSuffix, operatorBirthdate, operatorPhone,
        driverFirstName, driverMiddleName, driverLastName, driverSuffix, driverBirthdate, driverPhone,
        experienceYears, isLucenaVoter, votingLocation, capacity,
      } = req.body;

      // require Voter ID (as before)
      if (!req.files?.votersIDImage?.[0]) {
        return res.status(400).json({ error: "Voter's ID image is required" });
      }

      // uniqueness checks
      if ((role === "Driver" || role === "Both") && driverEmail) {
        const exists = await Driver.findOne({ email: driverEmail });
        if (exists) return res.status(400).json({ error: "Driver already exists" });
      }
      if ((role === "Operator" || role === "Both") && operatorEmail) {
        const exists = await Operator.findOne({ email: operatorEmail });
        if (exists) return res.status(400).json({ error: "Operator already exists" });
      }

      const profileID = uuidv4();
      const cap = Math.min(6, Math.max(1, Number(capacity) || 4));

      // Upload each provided image to Cloudinary
      async function maybeUpload(file, folder) {
        if (!file) return null;
        const r = await uploadBufferToCloudinary(file.buffer, {
          folder,
          resource_type: "image",
          transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
        });
        return r.secure_url;
      }

      const votersIDImageUrl = await maybeUpload(req.files?.votersIDImage?.[0], "toda-go/ids");
      const driversLicenseImageUrl = await maybeUpload(req.files?.driversLicenseImage?.[0], "toda-go/licenses");
      const orcrImageUrl = await maybeUpload(req.files?.orcrImage?.[0], "toda-go/orcr");
      const selfieImageUrl = await maybeUpload(req.files?.selfie?.[0], "toda-go/selfies");

      // Build Operator doc
      const newOperator = new Operator({
        profileID, franchiseNumber, todaName, sector,
        operatorFirstName, operatorMiddleName, operatorLastName, operatorSuffix,
        operatorName: `${operatorFirstName} ${operatorMiddleName} ${operatorLastName} ${operatorSuffix || ""}`.trim(),
        operatorBirthdate, operatorPhone,
        votersIDImage: votersIDImageUrl || null,
        driversLicenseImage: driversLicenseImageUrl || null,
        orcrImage: orcrImageUrl || null,
        selfieImage: selfieImageUrl || null, // ← field name matches Operator schema
        ...( (role === "Operator" || role === "Both") && operatorEmail ? { email: operatorEmail } : {} ),
        ...( (role === "Operator" || role === "Both") && operatorPassword ? { password: operatorPassword } : {} ),
        isVerified: false,
      });

      // Build Driver doc (Both copies operator info)
      const dFirst = role === "Both" ? operatorFirstName : driverFirstName;
      const dMiddle = role === "Both" ? operatorMiddleName : driverMiddleName;
      const dLast  = role === "Both" ? operatorLastName : driverLastName;
      const dSuf   = role === "Both" ? operatorSuffix : driverSuffix;
      const dBirth = role === "Both" ? operatorBirthdate : driverBirthdate;
      const dPhone = role === "Both" ? operatorPhone : driverPhone;

      const newDriver = new Driver({
        profileID, franchiseNumber, todaName, sector,
        driverFirstName: dFirst,
        driverMiddleName: dMiddle,
        driverLastName: dLast,
        driverSuffix: dSuf,
        driverName: `${dFirst} ${dMiddle} ${dLast} ${dSuf || ""}`.trim(),
        driverBirthdate: dBirth,
        driverPhone: dPhone,
        experienceYears, isLucenaVoter, votingLocation,
        capacity: cap,
        votersIDImage: votersIDImageUrl || null,
        driversLicenseImage: driversLicenseImageUrl || null,
        orcrImage: orcrImageUrl || null,
        selfieImage: selfieImageUrl || null, // ← field name matches Driver schema
        ...( (role === "Driver" || role === "Both") && driverEmail ? { email: driverEmail } : {} ),
        ...( (role === "Driver" || role === "Both") && driverPassword ? { password: driverPassword } : {} ),
        isVerified: false,
      });

      // Save both
      await newOperator.save();
      await newDriver.save();

      // Send verification emails (Driver + Operator if provided)
      const baseUrl = getBaseUrl(req);
      const buildVerifyUrl = (id) => {
        const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "1d" });
        return `${baseUrl}/api/auth/driver/verify-email?token=${encodeURIComponent(token)}`;
      };

      async function sendVerify(toEmail, displayName) {
        if (!toEmail) return;
        const verifyUrl = buildVerifyUrl(newDriver._id); // verifying the Driver account for the app
        await sendMail({
          to: toEmail,
          subject: "Verify your TodaGo Driver Account",
          html: `
            <p>Hello ${displayName || "there"},</p>
            <p>Please verify your account:</p>
            <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#1a73e8;color:#fff;border-radius:6px;text-decoration:none">Verify Email</a></p>
            <p>Or paste this link: ${verifyUrl}</p>
          `,
        });
      }

      if (role === "Driver" || role === "Both") {
        await sendVerify(driverEmail, newDriver.driverName);
      }
      if (role === "Operator" || role === "Both") {
        // Optional: also email operator if you want
        // await sendVerify(operatorEmail, newOperator.operatorName);
      }

      return res.status(201).json({ message: "Registration successful. Please verify your email. Check your Spam Mail" });
    } catch (error) {
      console.error("Driver registration failed:", error);
      return res.status(500).json({ error: "Server error", details: error.message });
    }
  }
);

// ---- Verify endpoint (Driver) ----
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

    const driver = await Driver.findById(decoded.id);
    if (!driver) return res.status(404).send("Account not found");

    if (driver.isVerified) return res.send("Already verified. You can log in.");
    driver.isVerified = true;
    await driver.save();

    return res.send("✅ Driver email verified! You can now log in.");
  } catch (e) {
    console.error("driver verify-email error:", e);
    return res.status(500).send("Server error");
  }
});

// ---- Resend verification (Driver) ----
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const driver = await Driver.findOne({ email });
    if (!driver) return res.status(404).json({ message: "No driver found" });
    if (driver.isVerified) return res.json({ message: "Already verified" });

    const baseUrl = process.env.BACKEND_BASE_URL || "";
    const token = jwt.sign({ id: driver._id }, process.env.JWT_SECRET, { expiresIn: "1d" });
    const verifyUrl = `${baseUrl || ""}/api/auth/driver/verify-email?token=${encodeURIComponent(token)}`;

    try {
      await sendMail({
        to: driver.email,
        subject: "Verify your TodaGo Driver Account",
        html: `
          <p>Hello ${driver.driverFirstName || "Driver"},</p>
          <p>Please verify your account by clicking below (expires in 24 hours):</p>
          <p><a href="${verifyUrl}" style="display:inline-block;padding:10px 16px;background:#1a73e8;color:#fff;border-radius:6px;text-decoration:none">Verify Email</a></p>
          <p>If the button doesn't work, copy and paste:<br>${verifyUrl}</p>
        `,
        text: `Verify: ${verifyUrl}`,
      });
    } catch (e) {
      console.error("❌ driver resend sendMail failed:", e.message);
      // Still return OK so UI doesn't block
    }

    return res.json({ message: "Verification email sent" });
  } catch (e) {
    console.error("driver resend-verification error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
