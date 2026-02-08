// routes/Appeals.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Appeal = require("../models/Appeal");
const Passenger = require("../models/Passenger");
const Driver = require("../models/Drivers");
const requireAdminAuth = require("../middleware/requireAdminAuth");

// ------------------------------
// Helpers
// ------------------------------
function isExpiredRestriction(restriction) {
  // expired only matters if endAt exists
  if (!restriction) return false;
  if (!restriction.isRestricted) return false;
  if (!restriction.endAt) return false; // indefinite or no end
  const end = new Date(restriction.endAt);
  if (isNaN(end.getTime())) return false;
  return end.getTime() <= Date.now();
}

// =============================================
// 📌 POST /api/appeals
// Mobile submits appeal
// =============================================
router.post("/", async (req, res) => {
  try {
    const { userType, userId, appealMessage } = req.body;

    if (!["passenger", "driver"].includes(userType)) {
      return res.status(400).json({ error: "Invalid userType" });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    const cleanMessage = String(appealMessage || "").trim();
    if (!cleanMessage) {
      return res.status(400).json({ error: "Appeal message is required" });
    }

    if (cleanMessage.length > 1000) {
      return res.status(400).json({ error: "Appeal message too long" });
    }

    // 🔎 Fetch user restriction info
    const Model = userType === "passenger" ? Passenger : Driver;
    const user = await Model.findById(userId).select("restriction").lean();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const restriction = user.restriction || null;

    // Optional: prevent spam — only one pending appeal
    const existingPending = await Appeal.findOne({
      userType,
      userId,
      status: "pending",
    });

    if (existingPending) {
      return res.status(400).json({
        error: "You already have a pending appeal.",
      });
    }
    
    const appeal = await Appeal.create({
      userType,
      userId,
      restrictionType: restriction?.type || "ban",
      restrictionReason: restriction?.reason || null,
      restrictionStartAt: restriction?.startAt || null,
      appealMessage: cleanMessage,
    });

    return res.json({
      ok: true,
      message: "Appeal submitted successfully.",
      appealId: appeal._id,
    });
  } catch (err) {
    console.error("❌ Appeal submit error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

// =============================================
// ✅ PUBLIC
// =============================================

// GET /api/appeals/latest?userType=passenger|driver&userId=...
router.get("/latest", async (req, res) => {
  try {
    const { userType, userId } = req.query;

    if (!["passenger", "driver"].includes(String(userType || ""))) {
      return res.status(400).json({ ok: false, error: "invalid_userType" });
    }

    if (!mongoose.Types.ObjectId.isValid(String(userId || ""))) {
      return res.status(400).json({ ok: false, error: "invalid_userId" });
    }

    const Model = String(userType) === "passenger" ? Passenger : Driver;
    const user = await Model.findById(String(userId)).select("restriction").lean();
    if (!user) return res.status(404).json({ ok: false, error: "user_not_found" });

    const r = user.restriction || null;

    // ✅ If user is currently restricted: return appeal for THIS restriction
    if (r?.isRestricted) {
      const startAt = r?.startAt ? new Date(r.startAt) : null;

      const latestForThisRestriction = await Appeal.findOne({
        userType: String(userType),
        userId: String(userId),
        restrictionStartAt: startAt,
      })
        .sort({ createdAt: -1 })
        .lean();

      return res.json({
        ok: true,
        appeal: latestForThisRestriction || null,
        currentRestriction: r, // optional, helpful
      });
    }

    // ✅ If user is NOT restricted anymore:
    // Return the most recent handled appeal so UI can show APPROVED/REJECTED message
    const latestHandled = await Appeal.findOne({
      userType: String(userType),
      userId: String(userId),
      status: { $in: ["approved", "rejected", "resolved"] },
    })
      .sort({ handledAt: -1, createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      appeal: latestHandled || null,
      currentRestriction: r, // optional
    });
  } catch (err) {
    console.error("❌ latest appeal error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// =============================================
// 🔒 ADMIN ROUTES
// =============================================

// Protect all /admin routes
router.use("/admin", requireAdminAuth);

// GET /api/appeals/admin
// ✅ Now returns computedStatus + autoResolvedReason if restriction expired/lifted
router.get("/admin", async (req, res) => {
  try {
    const appeals = await Appeal.find({})
      .sort({ createdAt: -1 })
      .lean();

    // collect unique ids per type
    const passengerIds = [];
    const driverIds = [];

    for (const a of appeals) {
      const uid = String(a.userId || "");
      if (!mongoose.Types.ObjectId.isValid(uid)) continue;

      if (a.userType === "passenger") passengerIds.push(uid);
      if (a.userType === "driver") driverIds.push(uid);
    }

    // fetch restrictions in bulk
    const [passengers, drivers] = await Promise.all([
      passengerIds.length
        ? Passenger.find({ _id: { $in: passengerIds } }).select("restriction").lean()
        : [],
      driverIds.length
        ? Driver.find({ _id: { $in: driverIds } }).select("restriction").lean()
        : [],
    ]);

    const pMap = {};
    for (const p of passengers) pMap[String(p._id)] = p?.restriction || null;

    const dMap = {};
    for (const d of drivers) dMap[String(d._id)] = d?.restriction || null;

    // enrich each appeal with computed fields
    const items = appeals.map((a) => {
      const uid = String(a.userId || "");
      const restriction =
        a.userType === "passenger" ? pMap[uid] : dMap[uid];

      const alreadyLifted =
        restriction && restriction.isRestricted === false;

      const expired = isExpiredRestriction(restriction);

      // only auto-resolve "pending" ones
      let computedStatus = a.status;
      let autoResolvedReason = null;

      if (a.status === "pending" && (expired || alreadyLifted)) {
        computedStatus = "resolved";
        autoResolvedReason = expired
          ? "restriction_expired"
          : "restriction_lifted";
      }

      return {
        ...a,
        computedStatus,
        autoResolvedReason,
        restrictionSnapshot: restriction || null, // optional: helpful for UI
      };
    });

    return res.json({
      ok: true,
      items,
    });
  } catch (err) {
    console.error("❌ Fetch appeals error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


router.patch("/admin/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid appeal id" });
    }

    const appeal = await Appeal.findById(id).lean();
    if (!appeal) return res.status(404).json({ error: "Appeal not found" });

    // prevent changing resolved ones
    if ((appeal.status || "").toLowerCase() === "resolved") {
      return res.status(400).json({ error: "Appeal already resolved" });
    }

    // ✅ pick model + validate user
    const Model = appeal.userType === "passenger" ? Passenger : Driver;

    if (!mongoose.Types.ObjectId.isValid(String(appeal.userId || ""))) {
      return res.status(400).json({ error: "Invalid userId in appeal" });
    }

    // ✅ Unrestrict user (lift ban/suspend)
    const now = new Date();
    const updatedUser = await Model.findByIdAndUpdate(
      appeal.userId,
      {
        $set: {
          "restriction.isRestricted": false,
          "restriction.updatedAt": now,
        },
        $unset: {
          "restriction.startAt": "",
          "restriction.endAt": "",
          "restriction.reason": "",
          "restriction.createdByAdminId": "",
        },
      },
      { new: true }
    ).lean();

    // If user was deleted, still allow approving the appeal
    // but tell frontend
    const userUnrestricted = !!updatedUser;

    // ✅ Update appeal decision
    const updatedAppeal = await Appeal.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "approved",
          adminNotes: adminNotes || null,
          handledByAdminId: req.admin?.id || null,
          handledAt: now,
        },
      },
      { new: true }
    ).lean();

    return res.json({
      ok: true,
      appeal: updatedAppeal,
      userUnrestricted,
      userType: appeal.userType,
      userId: String(appeal.userId),
    });
  } catch (err) {
    console.error("❌ Approve appeal error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


// PATCH /api/appeals/admin/:id/reject
router.patch("/admin/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid appeal id" });
    }

    const appeal = await Appeal.findById(id);
    if (!appeal) return res.status(404).json({ error: "Appeal not found" });

    appeal.status = "rejected";
    appeal.adminNotes = adminNotes || null;
    appeal.handledByAdminId = req.admin?.id || null;
    appeal.handledAt = new Date();

    await appeal.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Reject appeal error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
