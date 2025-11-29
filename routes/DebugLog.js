// routes/DebugLog.js
const express = require("express");
const router = express.Router();

router.post("/debug-log", (req, res) => {
  const { tag, payload } = req.body || {};

  console.log(
    `[FRONTEND:${tag || "general"}]`,
    JSON.stringify(payload || {}, null, 2)
  );

  return res.json({ ok: true });
});

module.exports = router;
