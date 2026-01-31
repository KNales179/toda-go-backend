const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const requireUserAuth = require("../middleware/requireUserAuth");

// GET notifications
// /api/notifications?userType=passenger&userId=...
router.get("/notifications", requireUserAuth, async (req, res) => {
  try {
    console.log("\n🧪 [NOTIF API] HIT GET /notifications");
    console.log("🧪 [NOTIF API] req.originalUrl:", req.originalUrl);
    console.log("🧪 [NOTIF API] query:", req.query);
    console.log("🧪 [NOTIF API] req.user:", req.user);

    const { userId, userType } = req.query;

    // Validate userId
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      console.log("❌ [NOTIF API] invalid userId:", userId);
      return res.status(400).json({ ok: false, message: "invalid userId" });
    }

    // Validate userType
    const uType = String(userType || "").toLowerCase();
    if (!uType || !["passenger", "driver"].includes(uType)) {
      console.log("❌ [NOTIF API] invalid userType:", userType);
      return res.status(400).json({ ok: false, message: "invalid userType" });
    }

    // ✅ Enforce role match: passenger token must request passenger notifications, etc.
    const tokenRole = String(req.user?.role || "").toLowerCase();
    if (tokenRole !== uType) {
      console.log("❌ [NOTIF API] role mismatch:", { tokenRole, requested: uType });
      return res.status(403).json({ ok: false, message: "Role not authorized" });
    }

    // ✅ Enforce ownership: token sub must match userId
    const tokenSub = String(req.user?.sub || "");
    if (tokenSub !== String(userId)) {
      console.log("❌ [NOTIF API] userId mismatch:", { tokenSub, userId });
      return res.status(403).json({ ok: false, message: "Not your notifications" });
    }

    const uid = new mongoose.Types.ObjectId(userId);

    const rows = await Notification.find({
      userId: uid,
      userType: uType,
    })
      .sort({ createdAt: -1 })
      .lean();

    console.log("✅ [NOTIF API] matched rows:", rows.length);
    if (rows[0]) console.log("✅ [NOTIF API] first row:", rows[0]?._id);

    return res.json({ ok: true, items: rows });
  } catch (e) {
    console.error("❌ [NOTIF API] list error:", e);
    return res.status(500).json({ ok: false, message: "server_error" });
  }
});

// mark as seen
router.patch("/notifications/:id/seen", requireUserAuth, async (req, res) => {
  try {
    console.log("\n🧪 [NOTIF API] HIT PATCH /notifications/:id/seen");
    console.log("🧪 [NOTIF API] id:", req.params.id);
    console.log("🧪 [NOTIF API] req.user:", req.user);

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "invalid id" });
    }

    const notif = await Notification.findById(id).lean();
    if (!notif) return res.status(404).json({ ok: false, message: "not_found" });

    // ✅ Owner-only enforcement
    const tokenRole = String(req.user?.role || "").toLowerCase();
    const tokenSub = String(req.user?.sub || "");

    if (String(notif.userType || "").toLowerCase() !== tokenRole) {
      console.log("❌ [NOTIF API] seen role mismatch:", {
        notifUserType: notif.userType,
        tokenRole,
      });
      return res.status(403).json({ ok: false, message: "Role not authorized" });
    }

    if (String(notif.userId) !== tokenSub) {
      console.log("❌ [NOTIF API] seen user mismatch:", {
        notifUserId: String(notif.userId),
        tokenSub,
      });
      return res.status(403).json({ ok: false, message: "Not your notification" });
    }

    const updated = await Notification.findByIdAndUpdate(
      id,
      { $set: { seenAt: new Date() } },
      { new: true }
    ).lean();

    return res.json({ ok: true, item: updated });
  } catch (e) {
    console.error("❌ [NOTIF API] seen error:", e);
    return res.status(500).json({ ok: false, message: "server_error" });
  }
});

// mark as read
router.patch("/notifications/:id/read", requireUserAuth, async (req, res) => {
  try {
    console.log("\n🧪 [NOTIF API] HIT PATCH /notifications/:id/read");
    console.log("🧪 [NOTIF API] id:", req.params.id);
    console.log("🧪 [NOTIF API] req.user:", req.user);

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, message: "invalid id" });
    }

    const notif = await Notification.findById(id).lean();
    if (!notif) return res.status(404).json({ ok: false, message: "not_found" });

    // ✅ Owner-only enforcement
    const tokenRole = String(req.user?.role || "").toLowerCase();
    const tokenSub = String(req.user?.sub || "");

    if (String(notif.userType || "").toLowerCase() !== tokenRole) {
      console.log("❌ [NOTIF API] read role mismatch:", {
        notifUserType: notif.userType,
        tokenRole,
      });
      return res.status(403).json({ ok: false, message: "Role not authorized" });
    }

    if (String(notif.userId) !== tokenSub) {
      console.log("❌ [NOTIF API] read user mismatch:", {
        notifUserId: String(notif.userId),
        tokenSub,
      });
      return res.status(403).json({ ok: false, message: "Not your notification" });
    }

    const updated = await Notification.findByIdAndUpdate(
      id,
      { $set: { readAt: new Date(), seenAt: new Date() } },
      { new: true }
    ).lean();

    return res.json({ ok: true, item: updated });
  } catch (e) {
    console.error("❌ [NOTIF API] read error:", e);
    return res.status(500).json({ ok: false, message: "server_error" });
  }
});

module.exports = router;
