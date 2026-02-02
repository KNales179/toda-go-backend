const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const requireUserAuth = require("../middleware/requireUserAuth");

// ------------------------------
// 🔒 shared validation + auth enforcement
// ------------------------------
function validateQuery(req, res) {
  const { userId, userType } = req.query;

  // Validate userId
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
    console.log("❌ [NOTIF API] invalid userId:", userId);
    res.status(400).json({ ok: false, message: "invalid userId" });
    return null;
  }

  // Validate userType
  const uType = String(userType || "").toLowerCase();
  if (!uType || !["passenger", "driver"].includes(uType)) {
    console.log("❌ [NOTIF API] invalid userType:", userType);
    res.status(400).json({ ok: false, message: "invalid userType" });
    return null;
  }

  // Enforce role match
  const tokenRole = String(req.user?.role || "").toLowerCase();
  if (tokenRole !== uType) {
    console.log("❌ [NOTIF API] role mismatch:", { tokenRole, requested: uType });
    res.status(403).json({ ok: false, message: "Role not authorized" });
    return null;
  }

  // Enforce ownership
  const tokenSub = String(req.user?.sub || "");
  if (tokenSub !== String(userId)) {
    console.log("❌ [NOTIF API] userId mismatch:", { tokenSub, userId });
    res.status(403).json({ ok: false, message: "Not your notifications" });
    return null;
  }

  return { uid: new mongoose.Types.ObjectId(userId), uType, userId };
}

// ------------------------------
// ✅ GET notifications
// /api/notifications?userType=driver&userId=...
// ------------------------------
router.get("/notifications", requireUserAuth, async (req, res) => {
  try {
    console.log("\n🧪 [NOTIF API] HIT GET /notifications");
    console.log("🧪 [NOTIF API] req.originalUrl:", req.originalUrl);
    console.log("🧪 [NOTIF API] query:", req.query);
    console.log("🧪 [NOTIF API] req.user:", req.user);

    const v = validateQuery(req, res);
    if (!v) return;

    const rows = await Notification.find({
      userId: v.uid,
      userType: v.uType,
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

// ------------------------------
// ✅ GET unseen-count (for badge)
// /api/notifications/unseen-count?userType=driver&userId=...
// ------------------------------
router.get("/notifications/unseen-count", requireUserAuth, async (req, res) => {
  try {
    console.log("\n🧪 [NOTIF API] HIT GET /notifications/unseen-count");
    const v = validateQuery(req, res);
    if (!v) return;

    const unseenCount = await Notification.countDocuments({
      userId: v.uid,
      userType: v.uType,
      seenAt: null,
    });

    return res.json({ ok: true, unseenCount });
  } catch (e) {
    console.error("❌ [NOTIF API] unseen-count error:", e);
    return res.status(500).json({ ok: false, message: "server_error" });
  }
});

// ------------------------------
// ✅ PATCH mark-all-seen (when opening notif screen)
// /api/notifications/mark-all-seen?userType=driver&userId=...
// ------------------------------
router.patch("/notifications/mark-all-seen", requireUserAuth, async (req, res) => {
  try {
    console.log("\n🧪 [NOTIF API] HIT PATCH /notifications/mark-all-seen");
    const v = validateQuery(req, res);
    if (!v) return;

    const r = await Notification.updateMany(
      {
        userId: v.uid,
        userType: v.uType,
        seenAt: null,
      },
      { $set: { seenAt: new Date() } }
    );

    return res.json({
      ok: true,
      matched: r.matchedCount ?? r.n ?? 0,
      modified: r.modifiedCount ?? r.nModified ?? 0,
    });
  } catch (e) {
    console.error("❌ [NOTIF API] mark-all-seen error:", e);
    return res.status(500).json({ ok: false, message: "server_error" });
  }
});

// ------------------------------
// ✅ PATCH mark as seen (single)
// ------------------------------
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

// ------------------------------
// ✅ PATCH mark as read (single)
// ------------------------------
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
