// middleware/requireAdminAuth.js
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

module.exports = async function requireAdminAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ ok: false, message: "Missing token" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const admin = await Admin.findById(decoded.id).lean();
    if (!admin || !admin.isActive) {
      return res.status(401).json({ ok: false, message: "Admin not authorized" });
    }

    req.admin = {
      id: admin._id.toString(),
      _id: admin._id,
      role: admin.role,
      username: admin.username,
      email: admin.email,
      name: admin.name,
      isActive: admin.isActive,
      twoFactorEnabled: !!admin.twoFactorEnabled,
      mustSetup2FA: !!admin.mustSetup2FA,
    };

    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Invalid or expired token" });
  }
};