// --- Health & Warmup (deduped + TTL) ---
const rateLimit = require("express-rate-limit");
const WARM_TTL_MS = 10 * 60 * 1000; // consider "warm" for 10 minutes

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
  // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const state = mongoose.connection.readyState;

  if (state === 1) return; // already connected
  if (state === 0) {
    // initiate connect with a timeout
    await withTimeout(
      mongoose.connect(process.env.MONGODB_URI, {
        // keep it light; your existing options are fine too
        serverSelectionTimeoutMS: 5000,
      }),
      7000,
      "mongo.connect"
    );
    return;
  }
  // if connecting/disconnecting, wait a bit
  await withTimeout(
    new Promise((r) => setTimeout(r, 1000)),
    1500,
    "mongo.wait"
  );
}

async function doWarmup() {
  // 1) Ensure DB up
  await ensureMongoConnected();

  // 2) Ping DB fast
  await withTimeout(
    mongoose.connection.db.admin().ping(),
    1500,
    "mongo.ping"
  );

  // 3) (Optional) Prime any hot path cache here (keep < 1–2s total)
  // e.g., await cache.primeMinimal();
}

// ---------- ROUTES ----------

// Cheap health: 200 if warm TTL says we’re warm; otherwise try a tiny ping.
// Never do heavy work here.
app.get("/health", async (req, res) => {
  if (Date.now() < warmUntil) return res.status(200).send("OK");

  try {
    // tiny reality check (fast timeout)
    if (!mongoose.connection.readyState) await ensureMongoConnected();
    await withTimeout(mongoose.connection.db.admin().ping(), 1200, "health.ping");
    // half TTL so health can extend warmth a bit after a successful ping
    warmUntil = Date.now() + Math.floor(WARM_TTL_MS / 2);
    return res.status(200).send("OK");
  } catch {
    return res.status(503).send("COLD");
  }
});

// Optional: small rate limit so bots can’t hammer /warmup
app.use(
  "/warmup",
  rateLimit({
    windowMs: 60_000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Idempotent warmup: only one active; others get 202 quickly
app.post("/warmup", async (req, res) => {
  if (warming) return res.status(202).send("WARMING");

  warming = true;
  res.status(202).send("WARMING"); // reply immediately; do work async

  try {
    await withTimeout(doWarmup(), 10_000, "doWarmup");
    warmUntil = Date.now() + WARM_TTL_MS;
    console.log("[warmup] done; warm until", new Date(warmUntil).toISOString());
  } catch (e) {
    console.error("[warmup] failed:", e?.message || e);
  } finally {
    warming = false;
  }
});
