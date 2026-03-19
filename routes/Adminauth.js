//Adminauth.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const requireAdminAuth = require("../middleware/requireAdminAuth");

function signToken(admin) {
  return jwt.sign(
    { id: admin._id.toString(), role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
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

    // only super_admin can create admins
    if (req.admin.role !== "super_admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    // do not allow creating super_admin from this route
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

    // super admin: require 2FA flow before issuing full token
    if (admin.role === "super_admin") {
      if (!admin.twoFactorEnabled) {
        return res.status(200).json({
          message: "2FA setup required",
          requires2FASetup: true,
          admin: admin.toSafeObject(),
        });
      }

      return res.status(200).json({
        message: "2FA verification required",
        requires2FA: true,
        admin: admin.toSafeObject(),
      });
    }

    admin.lastLoginAt = new Date();
    admin.lastLoginIp =
      req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      null;
    admin.lastLoginUserAgent = req.headers["user-agent"] || null;

    await admin.save();

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