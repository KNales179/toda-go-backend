// routes/cloudinaryPing.js
const router = require("express").Router();
const cloudinary = require("../utils/cloudinaryConfig");

router.get("/health/cloudinary", async (req, res) => {
  try {
    const ok = await cloudinary.api.ping();
    return res.json({ ok: true, cloud_name: ok.cloud_name });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
