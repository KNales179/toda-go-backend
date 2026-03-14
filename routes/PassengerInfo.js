const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const Booking = require("../models/Bookings");
const upload = require("../middleware/upload");
const requireUserAuth = require("../middleware/requireUserAuth");
const path = require("path");
const cloudinary = require("../utils/cloudinaryConfig");
const fs = require("fs");

const PASSENGER_SELF_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "birthday",
  "email",
  "profileImage",
  "gender",
  "phone",
  "contact",
  "eContactName",
  "eContactPhone",
  "isVerified",
  "discountVerification",
  "updatedAt",
  "restriction",
].join(" ");

const PASSENGER_RELATED_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "profileImage",
  "phone",
  "contact",
  "updatedAt",
].join(" ");

const PASSENGER_ADMIN_FIELDS = PASSENGER_SELF_FIELDS;

function computeStudentValidUntil(schoolYear) {
  const m = String(schoolYear || "").trim().match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (!m) return null;

  const start = Number(m[1]);
  const end = Number(m[2]);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  return new Date(end, 5, 30, 23, 59, 59);
}

async function uploadToCloudinary(localPath, folder) {
  const result = await cloudinary.uploader.upload(localPath, {
    folder,
    resource_type: "image",
  });
  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
}

async function canDriverAccessPassenger(driverId, passengerId) {
  const rel = await Booking.findOne({
    driverId: String(driverId),
    passengerId: String(passengerId),
    status: { $in: ["accepted", "ongoing", "completed"] },
  })
    .select("_id")
    .lean();

  return !!rel;
}

function sanitizePassengerSelf(passenger) {
  if (!passenger) return passenger;

  return {
    ...passenger,
    phone: passenger.phone || passenger.contact || null,
  };
}

function sanitizePassengerRelated(passenger) {
  if (!passenger) return passenger;

  return {
    _id: passenger._id,
    firstName: passenger.firstName || "",
    middleName: passenger.middleName || "",
    lastName: passenger.lastName || "",
    profileImage: passenger.profileImage || "",
    updatedAt: passenger.updatedAt || null,
    phone: passenger.phone || passenger.contact || null,
  };
}

function sanitizePassengerAdmin(passenger) {
  if (!passenger) return passenger;

  return {
    ...passenger,
    phone: passenger.phone || passenger.contact || null,
  };
}

router.get("/passenger/:id", requireUserAuth, async (req, res) => {
  try {
    const targetId = String(req.params.id);
    const requesterId = String(req.user?.sub || "");
    const requesterRole = String(req.user?.role || "");

    let select = null;
    let mode = null;

    if (requesterRole === "passenger" && requesterId === targetId) {
      select = PASSENGER_SELF_FIELDS;
      mode = "self";
    } else if (requesterRole === "driver") {
      const allowed = await canDriverAccessPassenger(requesterId, targetId);
      if (!allowed) {
        return res.status(403).json({ message: "Forbidden" });
      }
      select = PASSENGER_RELATED_FIELDS;
      mode = "related";
    } else if (requesterRole === "admin") {
      select = PASSENGER_ADMIN_FIELDS;
      mode = "admin";
    } else {
      return res.status(403).json({ message: "Forbidden" });
    }

    const p = await Passenger.findById(targetId).select(select);
    if (!p) return res.status(404).json({ message: "Passenger not found" });

    let result = p.toObject();

    if (mode === "self") result = sanitizePassengerSelf(result);
    if (mode === "related") result = sanitizePassengerRelated(result);
    if (mode === "admin") result = sanitizePassengerAdmin(result);

    return res.status(200).json({ passenger: result });
  } catch (err) {
    console.error("❌ Failed to fetch passenger info:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.get("/passengers", requireUserAuth, async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const passengers = await Passenger.find().select(
      "firstName middleName lastName email phone status"
    );
    return res.status(200).json(passengers);
  } catch (error) {
    console.error("❌ Failed to fetch passengers:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

router.patch("/passenger/:id", requireUserAuth, async (req, res) => {
  try {
    const targetId = String(req.params.id);
    const requesterId = String(req.user?.sub || "");
    const requesterRole = String(req.user?.role || "");

    if (!(requesterRole === "passenger" && requesterId === targetId) && requesterRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const {
      firstName,
      middleName,
      lastName,
      gender,
      birthday,
      phone,
      contact,
      eContactName,
      eContactPhone,
      email,
    } = req.body || {};

    const patch = {};
    if (firstName !== undefined) patch.firstName = String(firstName).trim();
    if (middleName !== undefined) patch.middleName = String(middleName || "").trim();
    if (lastName !== undefined) patch.lastName = String(lastName).trim();
    if (gender !== undefined) patch.gender = String(gender).trim();
    if (birthday !== undefined) patch.birthday = birthday;
    if (email !== undefined) patch.email = String(email).trim();

    if (phone !== undefined) {
      patch.phone = String(phone).trim();
    } else if (contact !== undefined && phone === undefined) {
      patch.phone = String(contact).trim();
      patch.contact = String(contact).trim();
    }

    if (eContactName !== undefined) patch.eContactName = String(eContactName).trim();
    if (eContactPhone !== undefined) patch.eContactPhone = String(eContactPhone).trim();

    const passenger = await Passenger.findByIdAndUpdate(targetId, patch, { new: true }).select(
      PASSENGER_SELF_FIELDS
    );

    if (!passenger) return res.status(404).json({ message: "Passenger not found" });

    return res.status(200).json({
      passenger: sanitizePassengerSelf(passenger.toObject()),
    });
  } catch (err) {
    console.error("❌ Passenger update error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/passenger/:id/photo",
  requireUserAuth,
  upload.single("profileImage"),
  async (req, res) => {
    try {
      const targetId = String(req.params.id);
      const requesterId = String(req.user?.sub || "");
      const requesterRole = String(req.user?.role || "");

      if (!(requesterRole === "passenger" && requesterId === targetId) && requesterRole !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
      }

      if (!req.file) return res.status(400).json({ message: "No image uploaded" });

      const relPath = path.join("uploads", req.file.filename);
      const passenger = await Passenger.findByIdAndUpdate(
        targetId,
        { profileImage: relPath },
        { new: true }
      ).select(PASSENGER_SELF_FIELDS);

      if (!passenger) return res.status(404).json({ message: "Passenger not found" });

      const avatarUrl = "/" + relPath.replace(/\\/g, "/");
      return res.status(200).json({
        passenger: sanitizePassengerSelf(passenger.toObject()),
        avatarUrl,
      });
    } catch (err) {
      console.error("❌ Passenger photo error:", err);
      return res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/passenger/:id/discount/submit",
  requireUserAuth,
  upload.fields([
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 },
  ]),
  async (req, res) => {
    let frontPath = null;
    let backPath = null;

    try {
      const passengerId = String(req.params.id);
      const requesterId = String(req.user?.sub || "");
      const requesterRole = String(req.user?.role || "");

      if (!(requesterRole === "passenger" && requesterId === passengerId) && requesterRole !== "admin") {
        return res.status(403).json({ ok: false, message: "Forbidden" });
      }

      const discountType = String(req.body?.discountType || "").trim();
      const schoolYear = String(req.body?.schoolYear || "").trim();

      if (!["Student", "Senior Citizen", "PWD"].includes(discountType)) {
        return res.status(400).json({ ok: false, message: "Invalid discountType" });
      }

      frontPath = req.files?.idFront?.[0]?.path || null;
      backPath = req.files?.idBack?.[0]?.path || null;

      if (!frontPath) {
        return res.status(400).json({ ok: false, message: "idFront image is required" });
      }

      let validUntil = null;
      if (discountType === "Student") {
        if (!schoolYear) {
          return res.status(400).json({ ok: false, message: "schoolYear is required for Student" });
        }
        validUntil = computeStudentValidUntil(schoolYear);
        if (!validUntil) {
          return res.status(400).json({
            ok: false,
            message: "Invalid schoolYear format. Use YYYY-YYYY (example 2025-2026).",
          });
        }
      }

      const folder = `todago/passengers/${passengerId}/discount`;

      const frontUp = await uploadToCloudinary(frontPath, folder);
      let backUp = { url: null, publicId: null };
      if (backPath) {
        backUp = await uploadToCloudinary(backPath, folder);
      }

      const passenger = await Passenger.findByIdAndUpdate(
        passengerId,
        {
          $set: {
            "discountVerification.type": discountType,
            "discountVerification.schoolYear": discountType === "Student" ? schoolYear : null,
            "discountVerification.validUntil": validUntil,
            "discountVerification.status": "pending",
            "discountVerification.idFrontUrl": frontUp.url,
            "discountVerification.idFrontPublicId": frontUp.publicId,
            "discountVerification.idBackUrl": backUp.url,
            "discountVerification.idBackPublicId": backUp.publicId,
            "discountVerification.submittedAt": new Date(),
            "discountVerification.reviewedAt": null,
            "discountVerification.reviewedByAdminId": null,
            "discountVerification.rejectionReason": null,
          },
        },
        { new: true }
      ).lean();

      if (!passenger) return res.status(404).json({ ok: false, message: "Passenger not found" });

      return res.json({
        ok: true,
        message: "Discount verification submitted. Please wait 1–3 business days.",
        discountVerification: passenger.discountVerification,
      });
    } catch (err) {
      console.error("❌ Discount submit error:", err);
      return res.status(500).json({ ok: false, message: "Server error" });
    } finally {
      try {
        if (frontPath && fs.existsSync(frontPath)) fs.unlinkSync(frontPath);
        if (backPath && fs.existsSync(backPath)) fs.unlinkSync(backPath);
      } catch {}
    }
  }
);

router.get("/passenger/:id/discount", requireUserAuth, async (req, res) => {
  try {
    const targetId = String(req.params.id);
    const requesterId = String(req.user?.sub || "");
    const requesterRole = String(req.user?.role || "");

    if (!(requesterRole === "passenger" && requesterId === targetId) && requesterRole !== "admin") {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    const p = await Passenger.findById(targetId).select("discountVerification").lean();
    if (!p) return res.status(404).json({ ok: false, message: "Passenger not found" });

    return res.json({ ok: true, discountVerification: p.discountVerification || null });
  } catch (e) {
    console.error("❌ Passenger discount fetch error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

module.exports = router;