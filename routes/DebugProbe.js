const express = require("express");
const router = express.Router();

router.get("/probe/fare-debug-abc123", (req, res) => {
  console.log("🔥 HIT PROBE ROUTE /probe/fare-debug-abc123");
  res.json({
    ok: true,
    source: "DebugProbe.js",
    path: "/probe/fare-debug-abc123",
    now: new Date().toISOString(),
  });
});

module.exports = router;