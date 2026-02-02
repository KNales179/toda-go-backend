// middleware/requireUserAuth.js
const jwt = require("jsonwebtoken");

module.exports = function requireUserAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, message: "Missing token" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET); // { sub, role }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, message: "Invalid or expired token" });
  }
};
