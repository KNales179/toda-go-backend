const express = require("express");
const router = express.Router();
const Driver = require("../models/Drivers");
const Operator = require("../models/Operator");
const upload = require("../middleware/upload");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { sendMail } = require("../utils/mailer");

// helper: consistent base URL
function getBaseUrl(req) {
  return (
    process.env.BACKEND_BASE_URL ||
    `${(req.headers["x-forwarded-proto"] || req.protocol)}://${req.get("host")}`
  );
}

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

      if (!req.files?.votersIDImage) {
        return res.status(400).json({ error: "Voter's ID image is required" });
      }

      // email uniqueness checks (if provided)
      if ((role === "Driver" || role === "Both") && driverEmail) {
        const exists = await Driver.findOne({ email: driverEmail });
        if (exists) return res.status(400).json({ error: "Driver already exists" });
      }
      if ((role === "Operator" || role === "Both") && operatorEmail) {
        const exists = await Operator.findOne({ email: operatorEmail });
        if (exists) return res.status(400).json({ error: "Operator already exists" });
      }

      const profileID = uuidv4();
      const selfieImage = req.files.selfie?.[0]?.path;
      const votersIDImage = req.files.votersIDImage[0].path;
      const driversLicenseImage = req.files.driversLicenseImage?.[0]?.path;
      const orcrImage = req.files.orcrImage?.[0]?.path;
      const cap = Math.min(6, Math.max(1, Number(capacity) || 4));

      // Build Operator doc (even if role=Driver; you were doing both)
      const newOperator = new Operator({
        profileID, franchiseNumber, todaName, sector,
        operatorFirstName, operatorMiddleName, operatorLastName, operatorSuffix,
        operatorName: `${operatorFirstName} ${operatorMiddleName} ${operatorLastName} ${operatorSuffix || ""}`.trim(),
        operatorBirthdate, operatorPhone,
        votersIDImage, driversLicenseImage, orcrImage, selfieImage,
        capacity: cap,
        // email/pass only if relevant
        ...( (role === "Operator" || role === "Both") && operatorEmail ? { email: operatorEmail } : {} ),
        ...( (role === "Operator" || role === "Both") && operatorPassword ? { password: operatorPassword } : {} ),
        isVerified: false,
      });

      // Build Driver doc
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
        votersIDImage, driversLicenseImage, orcrImage, selfieImage,
        ...( (role === "Driver" || role === "Both") && driverEmail ? { email: driverEmail } : {} ),
        ...( (role === "Driver" || role === "Both") && driverPassword ? { password: driverPassword } : {} ),
        isVerified: false,
      });

      // 🔐 Save first to get _id
      await newOperator.save();
      await newDriver.save();

      // ✉️ Send verification(s) to whichever email(s) exist
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

      // Send as appropriate
      if (role === "Driver" || role === "Both") {
        await sendVerify(
          "driver",
          newDriver._id,
          driverEmail,
          newDriver.driverName
        );
      }
      if (role === "Operator" || role === "Both") {
        await sendVerify(
          "operator",
          newOperator._id,
          operatorEmail,
          newOperator.operatorName
        );
      }

      return res.status(201).json({ message: "Registration successful. Please verify your email." });
    } catch (error) {
      console.error("Driver registration failed:", error);
      res.status(500).json({ error: "Server error", details: error.message });
    }
  }
);

// ✅ Verify endpoint (works for driver or operator)
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

    const { kind, id } = decoded;

    if (kind === "driver") {
      const doc = await Driver.findById(id);
      if (!doc) return res.status(404).send("Driver not found");
      if (!doc.isVerified) { doc.isVerified = true; await doc.save(); }
      return res.send("✅ Driver email verified. You can now log in.");
    } else if (kind === "operator") {
      const doc = await Operator.findById(id);
      if (!doc) return res.status(404).send("Operator not found");
      if (!doc.isVerified) { doc.isVerified = true; await doc.save(); }
      return res.send("✅ Operator email verified. You can now log in.");
    } else {
      return res.status(400).send("Invalid token payload");
    }
  } catch (e) {
    console.error("verify-email error:", e);
    return res.status(500).send("Server error");
  }
});

// Optional: resend
router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    const baseUrl = getBaseUrl(req);
    const driver = await Driver.findOne({ email });
    const operator = await Operator.findOne({ email });

    if (!driver && !operator) return res.status(404).json({ message: "No account found" });

    async function send(kind, id, to, name) {
      const token = jwt.sign({ kind, id }, process.env.JWT_SECRET, { expiresIn: "1d" });
      const verifyUrl = `${baseUrl}/api/auth/driver/verify-email?token=${encodeURIComponent(token)}`;
      await sendMail({
        to: driverEmail,                
        subject: "Verify your TodaGo Driver Account",
        html: `<p>Click to verify: <a href="${verifyUrl}">${verifyUrl}</a></p>`,
        text: `Verify: ${verifyUrl}`,   
      });

    }

    if (driver && !driver.isVerified) await send("driver", driver._id, driver.email, driver.driverName);
    if (operator && !operator.isVerified) await send("operator", operator._id, operator.email, operator.operatorName);

    return res.json({ message: "Verification email sent if your account was unverified." });
  } catch (e) {
    console.error("resend-verification error:", e);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
