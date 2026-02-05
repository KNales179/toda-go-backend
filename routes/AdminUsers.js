// routes/AdminUsers.js
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const Passenger = require("../models/Passenger");
const Driver = require("../models/Drivers");
const Notification = require("../models/Notification");
const requireAdminAuth = require("../middleware/requireAdminAuth");

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

// ------------------------------
// 🔧 HELPERS
// ------------------------------
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
// 🟩 GET ALL PASSENGERS (ADMIN)
// ------------------------------
router.get("/admin/passengers", async (req, res) => {
  try {
    const rows = await Passenger.find({}).sort({ createdAt: -1 }).lean();

    const items = rows.map((p) => {
      const isVerified = !!p.isVerified;

      return {
        id: String(p._id),
        name: fullName(p.firstName, p.middleName, p.lastName, p.suffix),
        email: p.email || "",
        contact: p.phone || p.contact || "",
        isVerified,
        status: isVerified ? "verified" : "not verified",
        raw: p,
      };
    });

    return res.json({ items, total: items.length });
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

    console.log("\n🧹 [DISCOUNT REJECT] passenger:", String(existing._id));
    console.log("🧹 [DISCOUNT REJECT] frontPublicId:", frontPublicId);
    console.log("🧹 [DISCOUNT REJECT] backPublicId:", backPublicId);

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

    console.log("🧹 [DISCOUNT REJECT] cloudinary delFront:", delFront);
    console.log("🧹 [DISCOUNT REJECT] cloudinary delBack:", delBack);

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

// ------------------------------
// 🟩 GET ALL DRIVERS
// ------------------------------
router.get("/admin/drivers", async (req, res) => {
  try {
    const rows = await Driver.find({}).sort({ createdAt: -1 }).lean();

    const items = rows.map((d) => {
      const name =
        d.driverName ||
        fullName(
          d.driverFirstName,
          d.driverMiddleName,
          d.driverLastName,
          d.driverSuffix
        ) ||
        "Driver";

      return {
        // A
        id: String(d._id),
        name,
        email: d.email || "",
        contact: d.driverPhone || "",

        // B
        franchiseNumber: d.franchiseNumber || "",
        plateNumber: d.plateNumber || "",
        todaName: d.todaName || "",
        sector: d.sector || "",

        // E
        experience: d.experienceYears || "",
        rating: d.rating ?? 0,
        ratingCount: d.ratingCount ?? 0,

        // D (✅ make it explicit for table)
        driverVerification: {
          status: d?.driverVerification?.status || "", // verify|reject|unverify|""(pending)
          reviewedAt: d?.driverVerification?.reviewedAt || null,
          rejectionReason: d?.driverVerification?.rejectionReason || null,
          reviewedByAdminId: d?.driverVerification?.reviewedByAdminId || null,
        },

        // keep old flags if other parts still use them
        driverVerified: !!d.driverVerified,
        isVerified: !!d.isVerified,

        // docs (table shows check only)
        documents: {
          votersIDImage: d.votersIDImage || "",
          driversLicenseImage: d.driversLicenseImage || "",
          orcrImage: d.orcrImage || "",
          selfieImage: d.selfieImage || "",
        },
        hasVotersId: !!d.votersIDImage,
        hasLicense: !!d.driversLicenseImage,
        hasOrcr: !!d.orcrImage,

        // payment (for modals)
        payment: {
          gcashNumber: d.gcashNumber || "",
          gcashQRUrl: d.gcashQRUrl || "",
        },

        // extra info for modals
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

        // keep raw if you still rely on it elsewhere
        raw: d,
      };
    });

    return res.json({ items, total: items.length });
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


module.exports = router;
