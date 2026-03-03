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

router.post("/register", async (req, res) => {
  try {
    const { name = "", username, email, password } = req.body;

    if (!username || !email || !password) {
      return res
        .status(400)
        .json({ message: "username, email, password are required" });
    }
    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const existing = await Admin.findOne({
      $or: [
        { email: String(email).toLowerCase() },
        { username: String(username).toLowerCase() },
      ],
    });

    if (existing) {
      return res
        .status(400)
        .json({ message: "Admin already exists (email/username taken)" });
    }

    const admin = await Admin.create({
      name,
      username,
      email,
      password,
    });

    const token = signToken(admin);

    return res.status(201).json({
      message: "Admin registered successfully",
      token,
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
    const { emailOrUsername, email, username, password } = req.body;

    const loginValue = (emailOrUsername || email || username || "")
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
    if (!ok) return res.status(400).json({ message: "Invalid credentials" });

    admin.lastLoginAt = new Date();
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
    },
  });
});

module.exports = router;