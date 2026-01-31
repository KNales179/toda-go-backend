// middleware/requireAdminAuth.js
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");

module.exports = async function requireAdminAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, message: "Missing token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET); // { id, role }

    // Optional but recommended: load admin to ensure still active
    const admin = await Admin.findById(decoded.id).lean();
    if (!admin || !admin.isActive) {
      return res.status(401).json({ ok: false, message: "Admin not authorized" });
    }

    // Put full admin info on req for later use
    req.admin = {
      id: admin._id.toString(),
      role: admin.role,
      username: admin.username,
      email: admin.email,
      name: admin.name,
    };

    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Invalid or expired token" });
  }
};
