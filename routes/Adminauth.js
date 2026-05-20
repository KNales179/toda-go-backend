const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");

const Admin = require("../models/Admin");
const AdminLoginChallenge = require("../models/AdminLoginChallenge");
const requireAdminAuth = require("../middleware/requireAdminAuth");

function signToken(admin) {
  return jwt.sign(
    { id: admin._id.toString(), role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

async function updateAdminLoginAudit(admin, req) {
  admin.lastLoginAt = new Date();
  admin.lastLoginIp = getClientIp(req);
  admin.lastLoginUserAgent = req.headers["user-agent"] || null;
  await admin.save();
}

function isValidOtp(code) {
  return /^\d{6}$/.test(String(code || "").trim());
}

// ADMIN-ONLY REGISTER
router.post("/register", requireAdminAuth, async (req, res) => {
  try {
    const { name = "", username, email, password, role } = req.body || {};

    const cleanName = String(name || "").trim();
    const cleanUsername = String(username || "").trim().toLowerCase();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");
    const cleanRole = String(role || "admin").trim().toLowerCase();

    if (!cleanUsername || !cleanEmail || !cleanPassword) {
      return res
        .status(400)
        .json({ message: "username, email, password are required" });
    }

    if (cleanPassword.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    if (req.admin.role !== "super_admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (cleanRole !== "admin") {
      return res.status(400).json({ message: "Invalid role" });
    }

    const existing = await Admin.findOne({
      $or: [{ email: cleanEmail }, { username: cleanUsername }],
    });

    if (existing) {
      return res
        .status(400)
        .json({ message: "Admin already exists (email/username taken)" });
    }

    const admin = await Admin.create({
      name: cleanName,
      username: cleanUsername,
      email: cleanEmail,
      password: cleanPassword,
      role: "admin",
      isActive: true,
      twoFactorEnabled: false,
      mustSetup2FA: false,
      createdByAdminId: req.admin.id,
    });

    return res.status(201).json({
      message: "Admin registered successfully",
      admin: admin.toSafeObject(),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Registration failed", error: error.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { emailOrUsername, email, username, password } = req.body || {};

    const loginValue = String(emailOrUsername || email || username || "")
      .toLowerCase()
      .trim();

    if (!loginValue || !password) {
      return res
        .status(400)
        .json({ message: "Login field and password are required" });
    }

    const admin = await Admin.findOne({
      $or: [{ email: loginValue }, { username: loginValue }],
    }).select("+password");

    if (!admin || !admin.isActive) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const ok = await admin.comparePassword(password);
    if (!ok) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (admin.role === "super_admin") {
      await AdminLoginChallenge.deleteMany({ adminId: admin._id });

      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      if (!admin.twoFactorEnabled || admin.mustSetup2FA) {
        const secret = speakeasy.generateSecret({
          name: `TODA Go (${admin.email})`,
          issuer: "TODA Go",
        });

        const challenge = await AdminLoginChallenge.create({
          adminId: admin._id,
          type: "setup_2fa",
          secret: secret.base32,
          expiresAt,
        });

        const qrCode = await QRCode.toDataURL(secret.otpauth_url);

        return res.status(200).json({
          message: "2FA setup required",
          requires2FASetup: true,
          challengeId: challenge._id.toString(),
          qrCode,
          manualCode: secret.base32,
          admin: admin.toSafeObject(),
        });
      }

      const challenge = await AdminLoginChallenge.create({
        adminId: admin._id,
        type: "verify_2fa",
        expiresAt,
      });

      return res.status(200).json({
        message: "2FA verification required",
        requires2FA: true,
        challengeId: challenge._id.toString(),
        admin: admin.toSafeObject(),
      });
    }

    await updateAdminLoginAudit(admin, req);

    const token = signToken(admin);

    return res.status(200).json({
      message: "Login successful",
      token,
      admin: admin.toSafeObject(),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Login failed", error: error.message });
  }
});

router.post("/login/setup-2fa", async (req, res) => {
  try {
    const { challengeId, code } = req.body || {};
    const cleanCode = String(code || "").trim();

    if (!challengeId || !isValidOtp(cleanCode)) {
      return res.status(400).json({ message: "Valid challengeId and 6-digit code are required" });
    }

    const challenge = await AdminLoginChallenge.findById(challengeId);
    if (!challenge) {
      return res.status(400).json({ message: "Invalid or expired 2FA challenge" });
    }

    if (challenge.type !== "setup_2fa") {
      return res.status(400).json({ message: "Invalid 2FA challenge type" });
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      await AdminLoginChallenge.deleteOne({ _id: challenge._id });
      return res.status(400).json({ message: "2FA challenge expired. Please log in again." });
    }

    const verified = speakeasy.totp.verify({
      secret: challenge.secret,
      encoding: "base32",
      token: cleanCode,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ message: "Invalid 2FA code" });
    }

    const admin = await Admin.findById(challenge.adminId).select("+twoFactorSecret");
    if (!admin || !admin.isActive) {
      await AdminLoginChallenge.deleteOne({ _id: challenge._id });
      return res.status(400).json({ message: "Admin not authorized" });
    }

    admin.twoFactorSecret = challenge.secret;
    admin.twoFactorEnabled = true;
    admin.mustSetup2FA = false;
    admin.twoFactorVerifiedAt = new Date();

    await updateAdminLoginAudit(admin, req);
    await AdminLoginChallenge.deleteMany({ adminId: admin._id });

    const token = signToken(admin);

    return res.status(200).json({
      message: "2FA setup complete",
      token,
      admin: admin.toSafeObject(),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "2FA setup failed", error: error.message });
  }
});

router.post("/login/verify-2fa", async (req, res) => {
  try {
    const { challengeId, code } = req.body || {};
    const cleanCode = String(code || "").trim();

    if (!challengeId || !isValidOtp(cleanCode)) {
      return res.status(400).json({ message: "Valid challengeId and 6-digit code are required" });
    }

    const challenge = await AdminLoginChallenge.findById(challengeId);
    if (!challenge) {
      return res.status(400).json({ message: "Invalid or expired 2FA challenge" });
    }

    if (challenge.type !== "verify_2fa") {
      return res.status(400).json({ message: "Invalid 2FA challenge type" });
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      await AdminLoginChallenge.deleteOne({ _id: challenge._id });
      return res.status(400).json({ message: "2FA challenge expired. Please log in again." });
    }

    const admin = await Admin.findById(challenge.adminId).select("+twoFactorSecret");
    if (!admin || !admin.isActive) {
      await AdminLoginChallenge.deleteOne({ _id: challenge._id });
      return res.status(400).json({ message: "Admin not authorized" });
    }

    if (!admin.twoFactorEnabled || !admin.twoFactorSecret) {
      await AdminLoginChallenge.deleteMany({ adminId: admin._id });
      return res.status(400).json({ message: "2FA is not set up for this account" });
    }

    const verified = speakeasy.totp.verify({
      secret: admin.twoFactorSecret,
      encoding: "base32",
      token: cleanCode,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ message: "Invalid 2FA code" });
    }

    admin.twoFactorVerifiedAt = new Date();

    await updateAdminLoginAudit(admin, req);
    await AdminLoginChallenge.deleteMany({ adminId: admin._id });

    const token = signToken(admin);

    return res.status(200).json({
      message: "2FA verified successfully",
      token,
      admin: admin.toSafeObject(),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "2FA verification failed", error: error.message });
  }
});

router.get("/me", requireAdminAuth, async (req, res) => {
  return res.json({
    admin: {
      id: req.admin.id,
      role: req.admin.role,
      username: req.admin.username,
      email: req.admin.email,
      name: req.admin.name,
      isActive: req.admin.isActive,
      twoFactorEnabled: req.admin.twoFactorEnabled,
      mustSetup2FA: req.admin.mustSetup2FA,
    },
  });
});

module.exports = router;