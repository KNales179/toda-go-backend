// routes/AdminUsers.js (or wherever this lives)
const express = require("express");
const router = express.Router();

const mongoose = require("mongoose");
const Passenger = require("../models/Passenger");
const Driver = require("../models/Drivers");
const Notification = require("../models/Notification");
const { safeDestroy } = require("../utils/cloudinaryConfig");
const requireAdminAuth = require("../middleware/requireAdminAuth");

router.use("/admin", requireAdminAuth);

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
// 🔔 (Optional) Expo push notify helper
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
// ✅ APPROVE discount verification (ADMIN)
// PATCH /api/admin/passengers/:id/discount/approve
// ------------------------------
router.patch("/admin/passengers/:id/discount/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { discountType } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    // If admin didn’t send type, fallback to whatever passenger submitted
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

    // notify passenger (push + socket)
    if (updated?.pushToken) {
      await sendExpoPush(
        updated.pushToken,
        "Discount Verification Approved",
        `Your ${typeFinal || "discount"} verification was approved.`,
        { type: "discount_verification", status: "approved", discountType: typeFinal }
      );
    }

    // optional socket broadcast
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

    // ✅ Load passenger first so we can delete Cloudinary images
    const existing = await Passenger.findById(id).lean();
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const frontPublicId = existing?.idFrontPublicId || null;
    const backPublicId = existing?.idBackPublicId || null;

    console.log("🧹 [DISCOUNT REJECT] delete front:", frontPublicId);
    console.log("🧹 [DISCOUNT REJECT] delete back:", backPublicId);

    // ✅ Delete from Cloudinary (safe even if null)
    const delFront = await safeDestroy(frontPublicId);
    const delBack = await safeDestroy(backPublicId);

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

          // ✅ clear stored proof image refs so they don’t linger
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
// 🟩 GET ALL DRIVERS (unchanged)
// ------------------------------
router.get("/admin/drivers", async (req, res) => {
  try {
    const rows = await Driver.find({}).sort({ createdAt: -1 }).lean();

    const items = rows.map((d) => ({
      id: String(d._id),
      name:
        d.driverName ||
        fullName(
          d.driverFirstName,
          d.driverMiddleName,
          d.driverLastName,
          d.driverSuffix
        ),
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
    if (!id) {
      return res.status(400).json({ error: "missing_id" });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "invalid_id" });
    }

    const deleted = await Driver.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: "not_found" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ Error deleting driver:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// ------------------------------
// ✅ PATCH /api/drivers/:id/verify
// ------------------------------
router.patch("/admin/drivers/:id/verify", async (req, res) => {
  try {
    const { id } = req.params;
    const { driverVerified = true } = req.body;

    const updated = await Driver.findByIdAndUpdate(
      id,
      { $set: { driverVerified: !!driverVerified } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ ok: false, error: "driver_not_found" });
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
