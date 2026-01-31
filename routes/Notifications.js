const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");

// GET notifications
// /api/notifications?userType=passenger&userId=...
router.get("/notifications", async (req, res) => {
  try {
    const { userId, userType } = req.query;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ ok: false, message: "invalid userId" });
    }
    if (!userType || !["passenger", "driver"].includes(String(userType).toLowerCase())) {
      return res.status(400).json({ ok: false, message: "invalid userType" });
    }

    const rows = await Notification.find({
      userId,
      userType: String(userType).toLowerCase(),
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("❌ notifications list error:", e);
    return res.status(500).json({ ok: false, message: "server_error" });
  }
});

// mark as seen
router.patch("/notifications/:id/seen", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "invalid id" });
    }

    const updated = await Notification.findByIdAndUpdate(
      id,
      { $set: { seenAt: new Date() } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, message: "not_found" });
    return res.json({ ok: true, item: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "server_error" });
  }
});

// mark as read
router.patch("/notifications/:id/read", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "invalid id" });
    }

    const updated = await Notification.findByIdAndUpdate(
      id,
      { $set: { readAt: new Date(), seenAt: new Date() } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, message: "not_found" });
    return res.json({ ok: true, item: updated });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "server_error" });
  }
});

module.exports = router;
