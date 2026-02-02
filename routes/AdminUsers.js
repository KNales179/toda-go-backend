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
router.use(requireAdminAuth);

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

    const items = rows.map((d) => ({
      id: String(d._id),
      name:
        d.driverName ||
        fullName(d.driverFirstName, d.driverMiddleName, d.driverLastName, d.driverSuffix),
      email: d.email || "",
      driverVerified: !!d.driverVerified,
      isVerified: !!d.isVerified,
      contact: d.driverPhone || "",
      gender: d.gender || "",
      birthday: d.driverBirthdate || "",
      address: d.homeAddress || "",
      profileID: d.profileID,
      franchiseNumber: d.franchiseNumber,
      todaName: d.todaName,
      sector: d.sector,
      experience: d.experienceYears,
      capacity: d.capacity,
      rating: d.rating,
      ratingCount: d.ratingCount,
      payment: {
        gcashNumber: d.gcashNumber,
        gcashQRUrl: d.gcashQRUrl,
      },
      verification: {
        isVerified: d.isVerified,
        isLucenaVoter: d.isLucenaVoter,
        votingLocation: d.votingLocation,
      },
      documents: {
        votersIDImage: d.votersIDImage,
        driversLicenseImage: d.driversLicenseImage,
        orcrImage: d.orcrImage,
        selfieImage: d.selfieImage,
      },
      raw: d,
    }));

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

// ------------------------------
// ✅ PATCH /api/admin/drivers/:id/verify
// - saves internal notification for driver
// - optional push + socket
// ------------------------------
router.patch("/admin/drivers/:id/verify", async (req, res) => {
  try {
    const { id } = req.params;
    const { driverVerified = true } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const updated = await Driver.findByIdAndUpdate(
      id,
      { $set: { driverVerified: !!driverVerified } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, error: "driver_not_found" });
    }

    // ✅ Save to Notification DB (internal notif for driver app)
    const adminName = req.admin?.username || req.admin?.email || "Admin";
    const title = !!driverVerified ? "Driver Account Verified" : "Driver Verification Removed";
    const message = !!driverVerified
      ? "Your driver account has been verified by the admin."
      : "Your driver verification status was removed. Please contact admin if this is unexpected.";

    await Notification.create({
      userId: updated._id,
      userType: "driver",
      category: "verification",
      title,
      message,
      createdByAdminId: req.admin.id,
      createdByAdminName: adminName,
      seenAt: null,
      readAt: null,
      meta: {
        type: "driver_verification",
        status: !!driverVerified ? "approved" : "reverted",
        driverVerified: !!driverVerified,
      },
    });

    // ✅ Optional push notification (if driver has pushToken)
    if (updated?.pushToken) {
      await sendExpoPush(updated.pushToken, title, message, {
        type: "driver_verification",
        status: !!driverVerified ? "approved" : "reverted",
      });
    }

    // ✅ Optional socket broadcast (driver can listen if you implement)
    if (req.io) {
      req.io.emit("driver:verification", {
        driverId: String(updated._id),
        driverVerified: !!driverVerified,
      });
    }

    return res.json({
      ok: true,
      driver: {
        id: String(updated._id),
        driverVerified: !!updated.driverVerified,
      },
    });
  } catch (err) {
    console.error("❌ verify driver error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

module.exports = router;
