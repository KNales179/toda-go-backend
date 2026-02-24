// routes/TasksRoute.js
const express = require("express");
const router = express.Router();
const Task = require("../models/Task");

// GET /api/tasks/:driverId -> list tasks
router.get("/tasks/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
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

// POST /api/tasks/:taskId/complete -> complete a task, unlock dependent
router.post("/tasks/:taskId/complete", async (req, res) => {
  try {
    const { taskId } = req.params;
    const t = await Task.findById(taskId);
    if (!t) return res.status(404).json({ ok: false, error: "Task not found" });

    if (t.status !== "COMPLETED") {
      t.status = "COMPLETED";
      t.completedAt = new Date();
      await t.save();

      await Task.updateMany(
        { dependsOnTaskId: t._id, status: "PENDING" },
        { $set: { status: "ACTIVE" } }
      );
    }

    return res.json({ ok: true, task: t });
  } catch (e) {
    console.error("Task complete error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

module.exports = router;
