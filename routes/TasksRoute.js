// routes/TasksRoute.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Task = require("../models/Task");
const Booking = require("../models/Bookings");
const requireUserAuth = require("../middleware/requireUserAuth");

router.use(requireUserAuth);
function haversineMeters(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

async function computeEligibleTasks(driverId) {
  // Open = PENDING or ACTIVE (ignore COMPLETED/CANCELED)
  const open = await Task.find({
    driverId: String(driverId),
    status: { $in: ["PENDING", "ACTIVE"] },
  }).lean();

  if (!open.length) return [];

  // Gather dependency ids
  const depIds = open
    .map((t) => t.dependsOnTaskId)
    .filter(Boolean)
    .map((id) => String(id));

  let completedDeps = new Set();
  if (depIds.length) {
    const deps = await Task.find({
      _id: { $in: depIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("_id status")
      .lean();

    completedDeps = new Set(
      deps.filter((d) => d.status === "COMPLETED").map((d) => String(d._id))
    );
  }

  // eligible = no dependency OR dependency COMPLETED
  return open.filter((t) => {
    if (!t.dependsOnTaskId) return true;
    return completedDeps.has(String(t.dependsOnTaskId));
  });
}

async function enforceSingleActiveAndPickNearest(driverId, curLat, curLng) {
  const cur = { lat: Number(curLat), lng: Number(curLng) };
  if (!Number.isFinite(cur.lat) || !Number.isFinite(cur.lng)) {
    return { chosenTaskId: null, chosenDistanceMeters: null };
  }

  const eligible = await computeEligibleTasks(driverId);

  let chosen = null;
  let best = Infinity;

  for (const t of eligible) {
    const d = haversineMeters(cur, { lat: Number(t.lat), lng: Number(t.lng) });
    if (d < best) {
      best = d;
      chosen = t;
    }
  }

  // HARD RULE: only 1 ACTIVE
  await Task.updateMany(
    { driverId: String(driverId), status: "ACTIVE" },
    { $set: { status: "PENDING" } }
  );

  if (chosen) {
    await Task.updateOne({ _id: chosen._id }, { $set: { status: "ACTIVE" } });
  }

  return {
    chosenTaskId: chosen ? String(chosen._id) : null,
    chosenDistanceMeters: chosen ? Math.round(best) : null,
  };
}

// GET /api/tasks/:driverId -> list tasks
router.get("/tasks/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    if (String(req.user?.role || "").toLowerCase() !== "driver" || String(req.user.sub || "") !== String(driverId)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    const tasks = await Task.find({
      driverId: String(driverId),
      status: { $ne: "CANCELED" },
    })
      .sort({ createdAt: 1 })
      .lean();
    return res.json({ ok: true, tasks });
  } catch (e) {
    console.error("Tasks list error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/tasks/replan  Body: { driverId, lat, lng }
router.post("/tasks/replan", async (req, res) => {
  try {
    const { lat, lng } = req.body || {};

    if (String(req.user?.role || "").toLowerCase() !== "driver") {
      return res.status(403).json({ ok: false, error: "Drivers only" });
    }

    const driverId = String(req.user.sub || "");

    const pick = await enforceSingleActiveAndPickNearest(driverId, lat, lng);

    const tasks = await Task.find({
      driverId: String(driverId),
      status: { $ne: "CANCELED" },
    })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({ ok: true, ...pick, tasks });
  } catch (e) {
    console.error("Tasks replan error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

// POST /api/tasks/:taskId/complete  Body: { driverLat, driverLng }
router.post("/tasks/:taskId/complete", async (req, res) => {
  try {
    const { taskId } = req.params;
    const { driverLat, driverLng } = req.body || {};

    const t = await Task.findById(taskId);
    if (String(req.user?.role || "").toLowerCase() !== "driver") {
      return res.status(403).json({ ok: false, error: "Drivers only" });
    }
    if (!t) return res.status(404).json({ ok: false, error: "Task not found" });
    if (String(t.driverId) !== String(req.user.sub || "")) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    if (t.status !== "COMPLETED") {
      t.status = "COMPLETED";
      t.completedAt = new Date();
      await t.save();
    }

    if (t.sourceType === "BOOKING" && t.sourceId) {
      try {
        const bookingId = String(t.sourceId);

        if (t.taskType === "PICKUP") {
          await Booking.findOneAndUpdate(
            { bookingId },
            {
              $set: {
                status: "accepted",
                progressStatus: "to_dropoff",
              },
            }
          );
        }

        if (t.taskType === "DROPOFF") {
          await Booking.findOneAndUpdate(
            { bookingId },
            {
              $set: {
                status: "accepted",
                progressStatus: "for_payment",
              },
            }
          );
        }
      } catch (err) {
        console.error("Task complete booking sync error:", err);
      }
    }

    // IMPORTANT: do NOT auto-activate dependent tasks.
    // They stay PENDING and become eligible now.

    // Replan immediately if driver location provided (recommended)
    const pick = await enforceSingleActiveAndPickNearest(t.driverId, driverLat, driverLng);

    const tasks = await Task.find({
      driverId: String(t.driverId),
      status: { $ne: "CANCELED" },
    })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({ ok: true, task: t, ...pick, tasks });
  } catch (e) {
    console.error("Task complete error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;