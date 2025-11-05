// routes/Driverauth.js
const express = require("express");
const router = express.Router();

const Driver = require("../models/Drivers");
const Operator = require("../models/Operator");

const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/mailer");

// --- Cloudinary + Multer (memory) ---
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../utils/cloudinaryConfig");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ---------- helpers ----------
function getBaseUrl(req) {
  return (
    process.env.BACKEND_BASE_URL ||
    `${(req.headers["x-forwarded-proto"] || req.protocol)}://${req.get("host")}`
  );
}

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const up = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result); // { secure_url, public_id, ... }
    });
    streamifier.createReadStream(buffer).pipe(up);
  });
}

function normalizePHMobile(input) {
  if (!input) return null;
  let s = String(input).replace(/[^\d+0-9]/g, "");
  if (s.startsWith("+639") && s.length === 13) return "0" + s.slice(3);
  if (s.startsWith("09") && s.length === 11) return s;
  return null;
}

async function safeDestroy(publicId) {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true,
    });
    log("destroyed old Cloudinary asset:", publicId);
  } catch (e) {
    console.warn("⚠️ Cloudinary destroy failed:", publicId, e?.message);
  }
}

// ===================================================================
// ================ G C A S H   E N D P O I N T S =====================
// ===================================================================

router.get("/:id/payment-info", async (req, res) => {
  try {
    const d = await Driver.findById(req.params.id).select(
      "gcashNumber gcashQRUrl gcashQRPublicId"
    );
    if (!d) return res.status(404).json({ ok: false, error: "Driver not found" });

    return res.json({
      ok: true,
      gcashNumber: d.gcashNumber || "",
      gcashQRUrl: d.gcashQRUrl || null,
      gcashQRPublicId: d.gcashQRPublicId || null,
    });
  } catch (e) {
    console.error("payment-info error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

/**
 * POST /api/auth/driver/:id/gcash-number
 * Body: { gcashNumber }
 * Normalizes and saves.
 */
router.post("/:id/gcash-number", async (req, res) => {
  try {
    const { id } = req.params;
    const normalized = normalizePHMobile(req.body?.gcashNumber);
    if (!normalized) {
      return res.status(400).json({
        ok: false,
        error: "Invalid PH mobile. Use 09xxxxxxxxx or +639xxxxxxxxx",
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      id,
      { gcashNumber: normalized },
      { new: true, select: "_id driverName gcashNumber" }
    );

    if (!driver) return res.status(404).json({ ok: false, error: "Driver not found" });

    return res.json({ ok: true, gcashNumber: driver.gcashNumber });
  } catch (err) {
    console.error("GCASH_NUM_SAVE", err);
    return res.status(500).json({ ok: false, error: "Save failed" });
  }
});

/**
 * POST /api/auth/driver/:id/gcash-qr
 * FormData: field "qr" (image)
 * Uploads new QR to Cloudinary, saves URL + public_id, deletes the old image.
 */
router.post("/:id/gcash-qr", upload.single("qr"), async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "No image uploaded" });
    }

    // Get current to know old public id
    const current = await Driver.findById(id).select("gcashQRPublicId");
    if (!current) return res.status(404).json({ ok: false, error: "Driver not found" });

    const oldPublicId = current.gcashQRPublicId || null;

    // Upload new asset (unique id so we can safely delete old)
    const up = await uploadBufferToCloudinary(req.file.buffer, {
      folder: "toda-go/gcash-qrs",
      resource_type: "image",
      transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
      public_id: `driver_${id}_gcashqr_${Date.now()}`,
    });

    // Persist new values
    const driver = await Driver.findByIdAndUpdate(
      id,
      { gcashQRUrl: up.secure_url, gcashQRPublicId: up.public_id },
      { new: true, select: "_id driverName gcashQRUrl gcashQRPublicId" }
    );

    // Fire-and-forget delete old image
    if (oldPublicId && oldPublicId !== up.public_id) {
      safeDestroy(oldPublicId);
    }

    return res.json({
      ok: true,
      gcashQRUrl: driver.gcashQRUrl,
      gcashQRPublicId: driver.gcashQRPublicId,
    });
  } catch (err) {
    console.error("GCASH_QR_UPLOAD", err);
    return res.status(500).json({ ok: false, error: "Upload failed" });
  }
});

// ===================================================================
// ==================== R E G I S T R A T I O N ======================
// ===================================================================

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

      // basic validation
      if (!req.files?.votersIDImage) {
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
      const savedImgs = {};

      if (req.files?.votersIDImage?.[0]) {
        const r = await uploadBufferToCloudinary(req.files.votersIDImage[0].buffer, {
          folder: "toda-go/ids",
          resource_type: "image",
          transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
        });
        savedImgs.votersIDImage = r.secure_url;
        savedImgs.votersIDImagePublicId = r.public_id;
      }

      if (req.files?.driversLicenseImage?.[0]) {
        const r = await uploadBufferToCloudinary(req.files.driversLicenseImage[0].buffer, {
          folder: "toda-go/licenses",
          resource_type: "image",
          transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
        });
        savedImgs.driversLicenseImage = r.secure_url;
        savedImgs.driversLicenseImagePublicId = r.public_id;
      }

      if (req.files?.orcrImage?.[0]) {
        const r = await uploadBufferToCloudinary(req.files.orcrImage[0].buffer, {
          folder: "toda-go/orcr",
          resource_type: "image",
          transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
        });
        savedImgs.orcrImage = r.secure_url;
        savedImgs.orcrImagePublicId = r.public_id;
      }

      if (req.files?.selfie?.[0]) {
        const r = await uploadBufferToCloudinary(req.files.selfie[0].buffer, {
          folder: "toda-go/selfies",
          resource_type: "image",
          transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
        });
        savedImgs.selfieImage = r.secure_url;
        savedImgs.selfieImagePublicId = r.public_id;
      }

      // Operator doc
      const newOperator = new Operator({
        profileID, franchiseNumber, todaName, sector,
        operatorFirstName, operatorMiddleName, operatorLastName, operatorSuffix,
        operatorName: `${operatorFirstName} ${operatorMiddleName} ${operatorLastName} ${operatorSuffix || ""}`.trim(),
        operatorBirthdate, operatorPhone,
        capacity: cap,

        votersIDImage: savedImgs.votersIDImage,
        driversLicenseImage: savedImgs.driversLicenseImage,
        orcrImage: savedImgs.orcrImage,
        selfieImage: savedImgs.selfieImage,

        votersIDImagePublicId: savedImgs.votersIDImagePublicId,
        driversLicenseImagePublicId: savedImgs.driversLicenseImagePublicId,
        orcrImagePublicId: savedImgs.orcrImagePublicId,
        selfieImagePublicId: savedImgs.selfieImagePublicId,

        ...((role === "Operator" || role === "Both") && operatorEmail ? { email: operatorEmail } : {}),
        ...((role === "Operator" || role === "Both") && operatorPassword ? { password: operatorPassword } : {}),
        isVerified: false,
      });

      // Driver doc (handle "Both")
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

        votersIDImage: savedImgs.votersIDImage,
        driversLicenseImage: savedImgs.driversLicenseImage,
        orcrImage: savedImgs.orcrImage,
        selfieImage: savedImgs.selfieImage,

        votersIDImagePublicId: savedImgs.votersIDImagePublicId,
        driversLicenseImagePublicId: savedImgs.driversLicenseImagePublicId,
        orcrImagePublicId: savedImgs.orcrImagePublicId,
        selfieImagePublicId: savedImgs.selfieImagePublicId,

        ...((role === "Driver" || role === "Both") && driverEmail ? { email: driverEmail } : {}),
        ...((role === "Driver" || role === "Both") && driverPassword ? { password: driverPassword } : {}),
        isVerified: false,
      });

      await newOperator.save();
      await newDriver.save();

      // send verification emails
      const baseUrl = getBaseUrl(req);
      async function sendVerify(kind, id, toEmail, displayName) {
        if (!toEmail) return;
        const token = jwt.sign({ kind, id }, process.env.JWT_SECRET, { expiresIn: "1d" });
        const verifyUrl = `${baseUrl}/api/auth/driver/verify-email?token=${encodeURIComponent(token)}`;
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
        await sendVerify("driver", newDriver._id, driverEmail, newDriver.driverName);
      }
      if (role === "Operator" || role === "Both") {
        await sendVerify("operator", newOperator._id, operatorEmail, newOperator.operatorName);
      }

      return res.status(201).json({
        message: "Registration successful. Please verify your email. Check your Spam Mail",
      });
    } catch (error) {
      console.error("Driver registration failed:", error);
      res.status(500).json({ error: "Server error", details: error.message });
    }
  }
);

const buildVerifyUrl = (id) => {
  const token = jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "1d" });
  return `${process.env.BACKEND_BASE_URL}/api/auth/driver/verify-email?token=${encodeURIComponent(token)}`;
};

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

router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const driver = await Driver.findOne({ email });
    if (!driver) return res.status(404).json({ message: "No driver found" });
    if (driver.isVerified) return res.json({ message: "Already verified" });

    const verifyUrl = buildVerifyUrl(driver._id);
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
    }

    return res.json({ message: "Verification email sent" });
  } catch (e) {
    console.error("driver resend-verification error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
