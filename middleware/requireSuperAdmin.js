// middleware/requireSuperAdmin.js
module.exports = function requireSuperAdmin(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (req.admin.role !== "super_admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  next();
};