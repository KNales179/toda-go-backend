// routes/Appeals.js
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

const Appeal = require("../models/Appeal");
const Passenger = require("../models/Passenger");
const Driver = require("../models/Drivers");
const requireAdminAuth = require("../middleware/requireAdminAuth");


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
    const user = await Model.findById(userId).select("restriction");

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
// 🔒 ADMIN ROUTES
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

    const latest = await Appeal.findOne({
      userType: String(userType),
      userId: String(userId),
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, appeal: latest || null });
  } catch (err) {
    console.error("❌ latest appeal error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});


// Protect all /admin routes
router.use("/admin", requireAdminAuth);


// GET /api/appeals/admin
router.get("/admin", async (req, res) => {
  try {
    const appeals = await Appeal.find({})
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      items: appeals,
    });
  } catch (err) {
    console.error("❌ Fetch appeals error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


// PATCH /api/appeals/admin/:id/approve
router.patch("/admin/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid appeal id" });
    }

    const appeal = await Appeal.findById(id);
    if (!appeal) return res.status(404).json({ error: "Appeal not found" });

    appeal.status = "approved";
    appeal.adminNotes = adminNotes || null;
    appeal.handledByAdminId = req.admin?.id || null;
    appeal.handledAt = new Date();

    await appeal.save();

    return res.json({ ok: true });
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
