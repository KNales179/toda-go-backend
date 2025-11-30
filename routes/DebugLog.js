const express = require("express");
const router = express.Router();

router.post("/debug-log", async (req, res) => {
  try {
    const { source, message, extra } = req.body;

    console.log("🟣 DEBUG LOG:", {
      source,
      message,
      extra,
      time: new Date().toISOString(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.log("❌ debug-log error:", err);
    res.status(500).json({ ok: false });
  }
});

module.exports = router;
