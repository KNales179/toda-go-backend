// routes/AdminUsers.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const Passenger = require("../models/Passenger");
const Driver = require("../models/Drivers");
const Notification = require("../models/Notification");
const requireAdminAuth = require("../middleware/requireAdminAuth");
const RestrictionLog = require("../models/RestrictionLog");

// ------------------------------
// 🔧 HELPERS
// ------------------------------

// ✅ robust Cloudinary delete (prevents "safeDestroy is not a function" crash)
let safeDestroy = async () => ({ result: "skipped" });
try {
  // If your utils/cloudinaryConfig exports { cloudinary }
  const cloud = require("../utils/cloudinaryConfig");
  const cloudinary = cloud?.cloudinary || cloud; // supports either export style
  safeDestroy = async (publicId) => {
    if (!publicId) return { result: "skipped" };
    try {
      const r = await cloudinary.uploader.destroy(publicId, {
        resource_type: "image",
        invalidate: true,
      });
      return r || { result: "ok" };
    } catch (e) {
      return { result: "error", error: e?.message || String(e) };
    }
  };
} catch {
  // keep safeDestroy stub
}

// ✅ protect all routes in this router (your endpoints are all /admin/* anyway)
router.use("/admin",requireAdminAuth);

function parseEndAt(endAt) {
  if (endAt === null || endAt === undefined || endAt === "") return null; // indefinite
  const d = new Date(endAt);
  if (isNaN(d.getTime())) return "INVALID";
  return d;
}

function fullName(first, middle, last, suffix = "") {
  return [first, middle, last, suffix]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ------------------------------
// 🔔 Expo push notify helper
// ------------------------------
async function sendExpoPush(pushToken, title, body, data = {}) {
  if (!pushToken) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: pushToken,
        title,
        body,
        data,
        sound: "default",
      }),
    });
  } catch (e) {
    console.error("❌ Expo push failed:", e);
  }
}

// ------------------------------
// 🟩 GET PASSENGERS (ADMIN) — PAGINATED
// supports: ?page=1&limit=10&q=...&status=verified|not verified&discountStatus=pending|approved|rejected|none
// ------------------------------
router.get("/admin/passengers", async (req, res) => {
  try {
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);

    const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 10;

    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase(); // "verified" | "not verified"
    const discountStatus = String(req.query.discountStatus || "").trim().toLowerCase(); // pending|approved|rejected|none

    const filter = {};

    // ✅ Account verification filter
    if (status === "verified") filter.isVerified = true;
    if (status === "not verified") filter.isVerified = false;

    // ✅ Discount verification filter
    // stored like: discountVerification.status
    if (discountStatus) {
      if (discountStatus === "none") {
        filter.$or = [
          { "discountVerification.status": { $exists: false } },
          { "discountVerification.status": null },
          { "discountVerification.status": "" },
          { "discountVerification.status": "none" },
        ];
      } else {
        filter["discountVerification.status"] = discountStatus;
      }
    }

    // ✅ Search (server-side)
    if (q) {
      const or = [];

      // if ObjectId-like search
      if (mongoose.Types.ObjectId.isValid(q)) {
        or.push({ _id: new mongoose.Types.ObjectId(q) });
      }

      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

      or.push(
        { firstName: rx },
        { middleName: rx },
        { lastName: rx },
        { email: rx },
        { phone: rx },
        { contact: rx }
      );

      // merge with existing $or if discountStatus used it
      if (filter.$or) {
        filter.$and = filter.$and || [];
        filter.$and.push({ $or: or });
      } else {
        filter.$or = or;
      }
    }

    const total = await Passenger.countDocuments(filter);

    const rows = await Passenger.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const items = rows.map((p) => {
      const isVerified = !!p.isVerified;

      return {
        id: String(p._id),
        name: fullName(p.firstName, p.middleName, p.lastName, p.suffix),
        email: p.email || "",
        contact: p.phone || p.contact || "",
        isVerified,
        status: isVerified ? "verified" : "not verified",
        isRestricted: !!p?.restriction?.isRestricted,
        restriction: p?.restriction || null,
        raw: p,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      items,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    console.error("❌ FAILED TO LOAD PASSENGERS:", err);
    return res.status(500).json({ error: "server_error" });
  }
});


// ------------------------------
// ✅ APPROVE discount verification (ADMIN)
// ------------------------------
router.patch("/admin/passengers/:id/discount/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { discountType } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const p = await Passenger.findById(id).lean();
    if (!p) return res.status(404).json({ ok: false, error: "not_found" });

    const typeFinal = discountType || p?.discountVerification?.type || null;

    const updated = await Passenger.findByIdAndUpdate(
      id,
      {
        $set: {
          discount: true,
          discountType: typeFinal,

          "discountVerification.status": "approved",
          "discountVerification.reviewedAt": new Date(),
          "discountVerification.rejectionReason": null,
          "discountVerification.reviewedByAdminId": req.admin.id,
        },
      },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    await Notification.create({
      userId: updated._id,
      userType: "passenger",
      category: "verification",
      title: "Discount Verification Approved",
      message: `Your ${typeFinal || "discount"} verification was approved.`,
      createdByAdminId: req.admin.id,
      createdByAdminName: req.admin.username || req.admin.email || "Admin",
      seenAt: null,
      readAt: null,
      meta: {
        type: "discount_verification",
        status: "approved",
        discountType: typeFinal,
      },
    });

    if (updated?.pushToken) {
      await sendExpoPush(
        updated.pushToken,
        "Discount Verification Approved",
        `Your ${typeFinal || "discount"} verification was approved.`,
        { type: "discount_verification", status: "approved", discountType: typeFinal }
      );
    }

    if (req.io) {
      req.io.emit("passenger:discount_verification", {
        passengerId: String(updated._id),
        status: "approved",
        discountType: typeFinal,
      });
    }

    return res.json({
      ok: true,
      passenger: {
        id: String(updated._id),
        discount: updated.discount,
        discountType: updated.discountType,
        discountVerification: updated.discountVerification,
      },
    });
  } catch (err) {
    console.error("❌ approve discount error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ❌ REJECT discount verification (ADMIN)
router.patch("/admin/passengers/:id/discount/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectionReason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const existing = await Passenger.findById(id).lean();
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const frontPublicId = existing.idFrontPublicId || null;
    const backPublicId = existing.idBackPublicId || null;

    let delFront = { result: "skipped" };
    let delBack = { result: "skipped" };

    try {
      delFront = await safeDestroy(frontPublicId);
    } catch (e) {
      console.error("❌ [DISCOUNT REJECT] delFront failed:", e?.message);
      delFront = { result: "error", error: e?.message };
    }

    try {
      delBack = await safeDestroy(backPublicId);
    } catch (e) {
      console.error("❌ [DISCOUNT REJECT] delBack failed:", e?.message);
      delBack = { result: "error", error: e?.message };
    }

    const updated = await Passenger.findByIdAndUpdate(
      id,
      {
        $set: {
          discount: false,
          discountType: null,

          "discountVerification.status": "rejected",
          "discountVerification.reviewedAt": new Date(),
          "discountVerification.rejectionReason": rejectionReason || "No reason provided",
          "discountVerification.reviewedByAdminId": req.admin.id,

          idFrontUrl: null,
          idFrontPublicId: null,
          idBackUrl: null,
          idBackPublicId: null,
        },
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    await Notification.create({
      userId: updated._id,
      userType: "passenger",
      category: "verification",
      title: "Discount Verification Rejected",
      message: `Your discount verification was rejected.`,
      createdByAdminId: req.admin.id,
      createdByAdminName: req.admin.username || req.admin.email || "Admin",
      seenAt: null,
      readAt: null,
      meta: {
        type: "discount_verification",
        status: "rejected",
        rejectionReason: updated.discountVerification?.rejectionReason || "",
        cloudinaryDelete: { delFront, delBack },
      },
    });

    if (updated?.pushToken) {
      await sendExpoPush(
        updated.pushToken,
        "Discount Verification Rejected",
        `Your discount verification was rejected.`,
        {
          type: "discount_verification",
          status: "rejected",
          rejectionReason: updated.discountVerification?.rejectionReason || "",
        }
      );
    }

    if (req.io) {
      req.io.emit("passenger:discount_verification", {
        passengerId: String(updated._id),
        status: "rejected",
        rejectionReason: updated.discountVerification?.rejectionReason || "",
      });
    }

    return res.json({
      ok: true,
      cloudinaryDelete: { delFront, delBack },
      passenger: {
        id: String(updated._id),
        discount: updated.discount,
        discountType: updated.discountType,
        discountVerification: updated.discountVerification,
      },
    });
  } catch (err) {
    console.error("❌ reject discount error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.patch("/admin/passengers/:id/restrict", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, endAt, type } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const endParsed = parseEndAt(endAt);
    if (endParsed === "INVALID") {
      return res.status(400).json({ ok: false, error: "invalid_endAt" });
    }

    const t = String(type || "ban").toLowerCase();
    const allowedType = ["ban", "suspend"];
    if (!allowedType.includes(t)) {
      return res.status(400).json({ ok: false, error: "invalid_type" });
    }

    const cleanReason = String(reason || "").trim();
    if (!cleanReason) {
      return res.status(400).json({ ok: false, error: "reason_required" });
    }

    const now = new Date();

    const updated = await Passenger.findByIdAndUpdate(
      id,
      {
        $set: {
          "restriction.isRestricted": true,
          "restriction.type": t,
          "restriction.reason": cleanReason,
          "restriction.startAt": now,
          "restriction.endAt": endParsed, // null = indefinite
          "restriction.createdByAdminId": req.admin?.id || null,
          "restriction.updatedAt": now,
        },
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    // ✅ Log
    await RestrictionLog.create({
      userType: "passenger",
      userId: updated._id,
      action: "restrict",
      restrictionType: t,
      reason: cleanReason,
      startAt: now,
      endAt: endParsed,
      createdByAdminId: req.admin?.id || null,
      createdByAdminName: req.admin?.username || req.admin?.email || "Admin",
    });

    return res.json({ ok: true, passengerId: String(updated._id), restriction: updated.restriction });
  } catch (err) {
    console.error("❌ restrict passenger error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.patch("/admin/passengers/:id/unrestrict", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {}; // optional note for log

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const now = new Date();

    const updated = await Passenger.findByIdAndUpdate(
      id,
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

    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    await RestrictionLog.create({
      userType: "passenger",
      userId: updated._id,
      action: "unrestrict",
      restrictionType: updated?.restriction?.type || "ban",
      reason: String(reason || "").trim(),
      startAt: null,
      endAt: null,
      createdByAdminId: req.admin?.id || null,
      createdByAdminName: req.admin?.username || req.admin?.email || "Admin",
    });

    return res.json({ ok: true, passengerId: String(updated._id) });
  } catch (err) {
    console.error("❌ unrestrict passenger error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});


// ------------------------------
// 🟩 GET DRIVERS (PAGINATED + SEARCH + STATUS FILTER)
// GET /api/admin/drivers?page=1&limit=10&q=...&status=pending|verified|rejected|unverified
// ------------------------------
router.get("/admin/drivers", async (req, res) => {
  try {
    // ---- pagination params ----
    const pageRaw = parseInt(req.query.page, 10);
    const limitRaw = parseInt(req.query.limit, 10);

    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const limit = Number.isFinite(limitRaw)
      ? Math.min(100, Math.max(1, limitRaw))
      : 10;

    const skip = (page - 1) * limit;

    // ---- search + status ----
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();

    const filter = {};

    // status mapping:
    // pending => missing/empty driverVerification.status
    // verified => "verify"
    // rejected => "reject"
    // unverified => "unverify"
    if (status) {
      if (status === "pending") {
        filter.$or = [
          { "driverVerification.status": { $exists: false } },
          { "driverVerification.status": null },
          { "driverVerification.status": "" },
        ];
      } else if (status === "verified") {
        filter["driverVerification.status"] = "verify";
      } else if (status === "rejected") {
        filter["driverVerification.status"] = "reject";
      } else if (status === "unverified") {
        filter["driverVerification.status"] = "unverify";
      }
    }

    // escape regex safely
    function escapeRegex(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // Search fields:
    // driverName, email, franchiseNumber, todaName, plateNumber, profileID
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");

      const searchOr = [
        { driverName: rx },
        { email: rx },
        { franchiseNumber: rx },
        { todaName: rx },
        { plateNumber: rx },
        { profileID: rx },
      ];

      // combine with existing filter (status pending uses $or)
      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          { $or: searchOr },
        ];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    // total count (matching)
    const total = await Driver.countDocuments(filter);

    // fetch page
    const rows = await Driver.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const items = rows.map((d) => {
      const name =
        d.driverName ||
        fullName(d.driverFirstName, d.driverMiddleName, d.driverLastName, d.driverSuffix) ||
        "Driver";

      return {
        id: String(d._id),
        name,
        email: d.email || "",
        contact: d.driverPhone || "",

        franchiseNumber: d.franchiseNumber || "",
        plateNumber: d.plateNumber || "",
        todaName: d.todaName || "",
        sector: d.sector || "",

        experience: d.experienceYears || "",
        rating: d.rating ?? 0,
        ratingCount: d.ratingCount ?? 0,

        driverVerification: {
          status: d?.driverVerification?.status || "",
          reviewedAt: d?.driverVerification?.reviewedAt || null,
          rejectionReason: d?.driverVerification?.rejectionReason || null,
          reviewedByAdminId: d?.driverVerification?.reviewedByAdminId || null,
        },

        driverVerified: !!d.driverVerified,
        isVerified: !!d.isVerified,

        documents: {
          votersIDImage: d.votersIDImage || "",
          driversLicenseImage: d.driversLicenseImage || "",
          orcrImage: d.orcrImage || "",
          selfieImage: d.selfieImage || "",
        },
        hasVotersId: !!d.votersIDImage,
        hasLicense: !!d.driversLicenseImage,
        hasOrcr: !!d.orcrImage,

        payment: {
          gcashNumber: d.gcashNumber || "",
          gcashQRUrl: d.gcashQRUrl || "",
        },

        gender: d.gender || "",
        birthday: d.driverBirthdate || "",
        address: d.homeAddress || "",
        profileID: d.profileID || "",
        capacity: d.capacity ?? null,
        verification: {
          isVerified: !!d.isVerified,
          isLucenaVoter: d.isLucenaVoter || "",
          votingLocation: d.votingLocation || "",
        },

        isRestricted: !!d?.restriction?.isRestricted,
        restriction: d?.restriction || null,

        isPresident: !!d.isPresident,
        todaPresName: d.todaPresName || "",

        raw: d,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      items,
      total,
      page,
      limit,
      totalPages,
    });
  } catch (err) {
    console.error("Error loading drivers:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// ------------------------------
// 🗑 DELETE DRIVER (ADMIN)
// ------------------------------
router.delete("/admin/drivers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: "missing_id" });
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "invalid_id" });

    const deleted = await Driver.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ error: "not_found" });

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error deleting driver:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

router.patch("/admin/drivers/:id/verify", async (req, res) => {
  try {
    const { id } = req.params;
    const { driverVerified, action, reason } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const nextVerified = !!driverVerified;

    // ✅ enforce action validity
    const act = String(action || "").toLowerCase();
    const allowed = ["verify", "reject", "unverify"];
    if (!allowed.includes(act)) {
      return res.status(400).json({ ok: false, error: "invalid_action" });
    }

    // ✅ enforce rule mapping
    // verify must be true, reject/unverify must be false
    if (act === "verify" && nextVerified !== true) {
      return res.status(400).json({ ok: false, error: "verify_must_be_true" });
    }
    if ((act === "reject" || act === "unverify") && nextVerified !== false) {
      return res.status(400).json({ ok: false, error: "reject_unverify_must_be_false" });
    }

    // ✅ require reason for reject/unverify (official workflow)
    const cleanReason = String(reason || "").trim();
    if ((act === "reject" || act === "unverify") && !cleanReason) {
      return res.status(400).json({ ok: false, error: "reason_required" });
    }

    const updated = await Driver.findByIdAndUpdate(
      id,
      {
        $set: {
          driverVerified: nextVerified,

          // optional: keep a mini audit trail on Driver doc
          "driverVerification.status": act, // verify | reject | unverify
          "driverVerification.reviewedAt": new Date(),
          "driverVerification.rejectionReason": act === "verify" ? null : cleanReason,
          "driverVerification.reviewedByAdminId": req.admin?.id || null,
        },
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "driver_not_found" });

    // ✅ Internal notification
    const adminName = req.admin?.username || req.admin?.email || "Admin";

    const title =
      act === "verify"
        ? "Driver Account Verified"
        : act === "reject"
        ? "Driver Verification Rejected"
        : "Driver Verification Removed";

    const message =
      act === "verify"
        ? "Your driver account has been verified by the admin."
        : act === "reject"
        ? `Your verification was rejected. Reason: ${cleanReason}`
        : `Your verification was removed. Reason: ${cleanReason}`;

    await Notification.create({
      userId: updated._id,
      userType: "driver",
      category: "verification",
      title,
      message,
      createdByAdminId: req.admin?.id || null,
      createdByAdminName: adminName,
      seenAt: null,
      readAt: null,
      meta: {
        type: "driver_verification",
        action: act,                  // ✅ verify | reject | unverify
        driverVerified: nextVerified,  // ✅ true/false
        reason: cleanReason || null,
      },
    });

    return res.json({
      ok: true,
      driver: { id: String(updated._id), driverVerified: !!updated.driverVerified },
    });
  } catch (err) {
    console.error("❌ driver verify/reject/unverify error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.patch("/admin/drivers/:id/president", async (req, res) => {
  try {
    const { id } = req.params;
    const { todaPresName } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const cleanToda = String(todaPresName || "").trim();

    // remove president
    if (!cleanToda) {
      const updated = await Driver.findByIdAndUpdate(
        id,
        { $set: { isPresident: false, todaPresName: "" } },
        { new: true }
      ).lean();

      if (!updated) return res.status(404).json({ ok: false, error: "driver_not_found" });

      return res.json({
        ok: true,
        message: "President role removed",
        driver: { id: String(updated._id), isPresident: !!updated.isPresident, todaPresName: updated.todaPresName || "" },
      });
    }

    // OPTIONAL: enforce 1 president per TODA (recommended)
    await Driver.updateMany(
      { isPresident: true, todaPresName: cleanToda, _id: { $ne: id } },
      { $set: { isPresident: false, todaPresName: "" } }
    );

    // set president
    const updated = await Driver.findByIdAndUpdate(
      id,
      { $set: { isPresident: true, todaPresName: cleanToda } },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "driver_not_found" });

    return res.json({
      ok: true,
      message: "Driver set as president",
      driver: { id: String(updated._id), isPresident: !!updated.isPresident, todaPresName: updated.todaPresName || "" },
    });
  } catch (err) {
    console.error("❌ set president error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});


// ------------------------------
// ✉️ ADMIN → DRIVER: SEND INTERNAL MESSAGE (Notify)
// POST /api/admin/drivers/:id/notify
// ------------------------------
router.post("/admin/drivers/:id/notify", async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, content, category, priority } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const cleanSubject = String(subject || "").trim();
    const cleanContent = String(content || "").trim();

    if (!cleanSubject) {
      return res.status(400).json({ ok: false, error: "subject_required" });
    }
    if (!cleanContent) {
      return res.status(400).json({ ok: false, error: "content_required" });
    }

    // ✅ Category must match Notification enum:
    // ["verification", "report", "feedback", "notice"]
    const cat = String(category || "notice").toLowerCase();
    const allowedCat = ["verification", "report", "feedback", "notice"];
    if (!allowedCat.includes(cat)) {
      return res.status(400).json({ ok: false, error: "invalid_category" });
    }

    const pr = String(priority || "normal").toLowerCase();
    const allowedPr = ["normal", "urgent"];
    const prFinal = allowedPr.includes(pr) ? pr : "normal";

    const driver = await Driver.findById(id).lean();
    if (!driver) return res.status(404).json({ ok: false, error: "driver_not_found" });

    const adminName = req.admin?.username || req.admin?.email || "Admin";
    const toName =
      driver.driverName ||
      fullName(driver.driverFirstName, driver.driverMiddleName, driver.driverLastName, driver.driverSuffix) ||
      "Driver";

    const created = await Notification.create({
      userId: driver._id,
      userType: "driver",
      category: cat,
      title: cleanSubject,
      message: cleanContent,
      createdByAdminId: req.admin?.id || null,
      createdByAdminName: adminName,
      seenAt: null,
      readAt: null,
      meta: {
        type: "admin_message",
        fromLabel: `TFRO Admin - ${adminName}`,
        toLabel: toName,
        priority: prFinal,
      },
    });

    return res.json({
      ok: true,
      notificationId: String(created._id),
    });
  } catch (err) {
    console.error("❌ notify driver error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.post("/admin/passengers/:id/notify", async (req, res) => {
  try {
    const { id } = req.params;
    const { subject, content, category, priority } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const cleanSubject = String(subject || "").trim();
    const cleanContent = String(content || "").trim();

    if (!cleanSubject) {
      return res.status(400).json({ ok: false, error: "subject_required" });
    }
    if (!cleanContent) {
      return res.status(400).json({ ok: false, error: "content_required" });
    }

    // Category must match Notification enum:
    // ["verification", "report", "feedback", "notice"]
    const cat = String(category || "notice").toLowerCase();
    const allowedCat = ["verification", "report", "feedback", "notice"];
    if (!allowedCat.includes(cat)) {
      return res.status(400).json({ ok: false, error: "invalid_category" });
    }

    const pr = String(priority || "normal").toLowerCase();
    const allowedPr = ["normal", "urgent"];
    const prFinal = allowedPr.includes(pr) ? pr : "normal";

    const passenger = await Passenger.findById(id).lean();
    if (!passenger) return res.status(404).json({ ok: false, error: "not_found" });

    const adminName = req.admin?.username || req.admin?.email || "Admin";
    const toName = fullName(passenger.firstName, passenger.middleName, passenger.lastName, passenger.suffix) || "Passenger";

    const created = await Notification.create({
      userId: passenger._id,
      userType: "passenger",
      category: cat,
      title: cleanSubject,
      message: cleanContent,
      createdByAdminId: req.admin?.id || null,
      createdByAdminName: adminName,
      seenAt: null,
      readAt: null,
      meta: {
        type: "admin_message",
        fromLabel: `TFRO Admin - ${adminName}`,
        toLabel: toName,
        priority: prFinal,
      },
    });

    return res.json({
      ok: true,
      notificationId: String(created._id),
    });
  } catch (err) {
    console.error("❌ notify passenger error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});


router.patch("/admin/drivers/:id/restrict", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, endAt, type } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const endParsed = parseEndAt(endAt);
    if (endParsed === "INVALID") {
      return res.status(400).json({ ok: false, error: "invalid_endAt" });
    }

    const t = String(type || "ban").toLowerCase();
    const allowedType = ["ban", "suspend"];
    if (!allowedType.includes(t)) {
      return res.status(400).json({ ok: false, error: "invalid_type" });
    }

    const cleanReason = String(reason || "").trim();
    if (!cleanReason) {
      return res.status(400).json({ ok: false, error: "reason_required" });
    }

    const now = new Date();

    const updated = await Driver.findByIdAndUpdate(
      id,
      {
        $set: {
          "restriction.isRestricted": true,
          "restriction.type": t,
          "restriction.reason": cleanReason,
          "restriction.startAt": now,
          "restriction.endAt": endParsed,
          "restriction.createdByAdminId": req.admin?.id || null,
          "restriction.updatedAt": now,
        },
      },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    await RestrictionLog.create({
      userType: "driver",
      userId: updated._id,
      action: "restrict",
      restrictionType: t,
      reason: cleanReason,
      startAt: now,
      endAt: endParsed,
      createdByAdminId: req.admin?.id || null,
      createdByAdminName: req.admin?.username || req.admin?.email || "Admin",
    });

    return res.json({ ok: true, driverId: String(updated._id), restriction: updated.restriction });
  } catch (err) {
    console.error("❌ restrict driver error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.patch("/admin/drivers/:id/unrestrict", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const now = new Date();

    const updated = await Driver.findByIdAndUpdate(
      id,
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

    if (!updated) return res.status(404).json({ ok: false, error: "not_found" });

    await RestrictionLog.create({
      userType: "driver",
      userId: updated._id,
      action: "unrestrict",
      restrictionType: updated?.restriction?.type || "ban",
      reason: String(reason || "").trim(),
      startAt: null,
      endAt: null,
      createdByAdminId: req.admin?.id || null,
      createdByAdminName: req.admin?.username || req.admin?.email || "Admin",
    });

    return res.json({ ok: true, driverId: String(updated._id) });
  } catch (err) {
    console.error("❌ unrestrict driver error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

router.get("/admin/passengers/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }

    const p = await Passenger.findById(id).lean();
    if (!p) return res.status(404).json({ error: "not_found" });

    return res.json({
      _id: p._id,
      firstName: p.firstName || "",
      middleName: p.middleName || "",
      lastName: p.lastName || "",
      suffix: p.suffix || "",
      email: p.email || "",
      profileImage: p.profileImage || p.selfieImage || null,
      role: "passenger",
    });
  } catch (err) {
    console.error("❌ get passenger error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});


router.get("/admin/drivers/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }

    const d = await Driver.findById(id).lean();
    if (!d) return res.status(404).json({ error: "not_found" });

    return res.json({
      _id: d._id,
      firstName: d.driverFirstName || "",
      middleName: d.driverMiddleName || "",
      lastName: d.driverLastName || "",
      suffix: d.driverSuffix || "",
      email: d.email || "",
      profileImage: d.selfieImage || null,
      role: "driver",
    });
  } catch (err) {
    console.error("❌ get driver error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});


module.exports = router;
