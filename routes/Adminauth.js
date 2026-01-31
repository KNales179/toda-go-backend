// routes/AdminAuth.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

function signToken(admin) {
  return jwt.sign(
    { id: admin._id.toString(), role: admin.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// Middleware: verify token
function requireAdminAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Missing token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded; // {id, role}
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

/**
 * POST /api/admin/register
 * body: { name?, username, email, password }
 */
router.post("/register", async (req, res) => {
  try {
    const { name = "", username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "username, email, password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const existing = await Admin.findOne({
      $or: [
        { email: String(email).toLowerCase() },
        { username: String(username).toLowerCase() },
      ],
    });

    if (existing) {
      return res.status(400).json({ message: "Admin already exists (email/username taken)" });
    }

    const admin = await Admin.create({
      name,
      username,
      email,
      password, // ✅ hashed by pre-save hook
    });

    const token = signToken(admin);

    return res.status(201).json({
      message: "Admin registered successfully",
      token,
      admin: admin.toSafeObject(),
    });
  } catch (error) {
    return res.status(500).json({ message: "Registration failed", error: error.message });
  }
});

/**
 * POST /api/admin/login
 * body: { emailOrUsername, password }
 * (or support email + password for your existing UI)
 */
router.post("/login", async (req, res) => {
  try {
    const { emailOrUsername, email, username, password } = req.body;

    const loginValue = (emailOrUsername || email || username || "").toLowerCase().trim();
    if (!loginValue || !password) {
      return res.status(400).json({ message: "Login field and password are required" });
    }

    // Need password → use select("+password") because schema has select:false
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
    return res.status(500).json({ message: "Login failed", error: error.message });
  }
});

/**
 * GET /api/admin/me
 * headers: Authorization: Bearer <token>
 * helps you verify frontend is connected and token works
 */
router.get("/me", requireAdminAuth, async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.id);
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    return res.json({ admin: admin.toSafeObject() });
  } catch (err) {
    return res.status(500).json({ message: "Failed to load admin" });
  }
});

module.exports = router;
