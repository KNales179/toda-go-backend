const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");

// GET notifications
// /api/notifications?userType=passenger&userId=...
router.get("/notifications", async (req, res) => {
  try {
    console.log("\n🧪 [NOTIF API] HIT GET /notifications");
    console.log("🧪 [NOTIF API] req.originalUrl:", req.originalUrl);
    console.log("🧪 [NOTIF API] query:", req.query);

    const { userId, userType } = req.query;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      console.log("❌ [NOTIF API] invalid userId:", userId);
      return res.status(400).json({ ok: false, message: "invalid userId" });
    }

    const uType = String(userType || "").toLowerCase();
    if (!uType || !["passenger", "driver"].includes(uType)) {
      console.log("❌ [NOTIF API] invalid userType:", userType);
      return res.status(400).json({ ok: false, message: "invalid userType" });
    }

    // force ObjectId
    const uid = new mongoose.Types.ObjectId(userId);

    const rows = await Notification.find({
      userId: uid,
      userType: uType,
    })
      .sort({ createdAt: -1 })
      .lean();

    console.log("✅ [NOTIF API] matched rows:", rows.length);
    if (rows[0]) console.log("✅ [NOTIF API] first row:", rows[0]);

    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("❌ [NOTIF API] list error:", e);
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
