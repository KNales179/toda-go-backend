// routes/warmup.js
const express = require("express");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit"); // remove if you don't want it
const router = express.Router();

const WARM_TTL_MS = 10 * 60 * 1000; // 10 minutes
let warming = false;
let warmUntil = 0; // ms timestamp

function withTimeout(promise, ms, label = "op") {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`${label}: timeout after ${ms}ms`)), ms)
    ),
  ]);
}

async function ensureMongoConnected() {
  const state = mongoose.connection.readyState; // 0,1,2,3
  if (state === 1) return;
  if (state === 0) {
    await withTimeout(
      mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
      }),
      7000,
      "mongo.connect"
    );
    return;
  }
  await withTimeout(new Promise((r) => setTimeout(r, 1000)), 1500, "mongo.wait");
}

async function doWarmup() {
  await ensureMongoConnected();
  await withTimeout(mongoose.connection.db.admin().ping(), 1500, "mongo.ping");
  // (optional) prime caches here
}

// Cheap health: fast 200 if warm, else tiny ping.
router.get("/health", async (req, res) => {
  if (Date.now() < warmUntil) return res.status(200).send("OK");
  try {
    if (!mongoose.connection.readyState) await ensureMongoConnected();
    await withTimeout(mongoose.connection.db.admin().ping(), 1200, "health.ping");
    warmUntil = Date.now() + Math.floor(WARM_TTL_MS / 2);
    return res.status(200).send("OK");
  } catch {
    return res.status(503).send("COLD");
  }
});

// Optional: rate limit only this path
router.use(
  "/warmup",
  rateLimit({
    windowMs: 60_000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Idempotent warmup: only one runs; others get 202 quickly
router.post("/warmup", async (req, res) => {
  if (warming) return res.status(202).send("WARMING");
  warming = true;
  res.status(202).send("WARMING"); // respond immediately

  try {
    await withTimeout(doWarmup(), 10_000, "doWarmup");
    warmUntil = Date.now() + WARM_TTL_MS;
  } catch (e) {
    console.error("[warmup] failed:", e?.message || e);
  } finally {
    warming = false;
  }
});

module.exports = router;
