// routes/PassengerInfo.js
const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const upload = require("../middleware/upload");
const path = require("path");
const cloudinary = require("../utils/cloudinaryConfig");
const fs = require("fs");


function computeStudentValidUntil(schoolYear) {
  // expects "YYYY-YYYY"
  const m = String(schoolYear || "").trim().match(/^(\d{4})\s*-\s*(\d{4})$/);
  if (!m) return null;

  const start = Number(m[1]);
  const end = Number(m[2]);

  // basic sanity: end should be start+1 typically, but we won't be strict
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  // valid until end of school year (June 30 of end year) – adjust if you want March/April
  return new Date(end, 5, 30, 23, 59, 59); // month 5 = June
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


// GET /api/passenger/:id ➜ fetch name/details (now returns canonical phone + e-contact fields)
router.get("/passenger/:id", async (req, res) => {
  try {
    const p = await Passenger.findById(req.params.id).select(
      "firstName middleName lastName birthday email profileImage gender phone contact eContactName eContactPhone isVerified"
    );
    if (!p) return res.status(404).json({ message: "Passenger not found" });

    // ensure API always exposes `phone` (fallback to legacy `contact`)
    const result = {
      ...p.toObject(),
      phone: p.phone || p.contact || null,
    };

    return res.status(200).json({ passenger: result });
  } catch (err) {
    console.error("❌ Failed to fetch passenger info:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// GET /api/passengers ➜ simple list (unchanged)
router.get("/passengers", async (req, res) => {
  try {
    const passengers = await Passenger.find().select(
      "firstName middleName lastName email phone status"
    );
    return res.status(200).json(passengers);
  } catch (error) {
    console.error("❌ Failed to fetch passengers:", error);
    return res.status(500).json({ message: "Server error" });
  }
});

// PATCH /api/passenger/:id ➜ update selected fields
router.patch("/passenger/:id", async (req, res) => {
  try {
    // Accept the fields we intend to edit from the app
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
    if (birthday !== undefined) patch.birthday = birthday; // trust client ISO; validate on client/UI
    if (email !== undefined) patch.email = String(email).trim();

    // Phone handling: prefer new `phone`, fallback from legacy `contact`
    if (phone !== undefined) {
      patch.phone = String(phone).trim();
    } else if (contact !== undefined && (phone === undefined)) {
      patch.phone = String(contact).trim();
      // optional: keep legacy mirror for now
      patch.contact = String(contact).trim();
    }

    if (eContactName !== undefined) patch.eContactName = String(eContactName).trim();
    if (eContactPhone !== undefined) patch.eContactPhone = String(eContactPhone).trim();

    const passenger = await Passenger.findByIdAndUpdate(
      req.params.id,
      patch,
      { new: true }
    );
    if (!passenger) return res.status(404).json({ message: "Passenger not found" });

    // ensure `phone` is present in response for the app
    const result = {
      ...passenger.toObject(),
      phone: passenger.phone || passenger.contact || null,
    };

    return res.status(200).json({ passenger: result });
  } catch (err) {
    console.error("❌ Passenger update error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// POST /api/passenger/:id/photo ➜ upload profile image (field: profileImage)
router.post("/passenger/:id/photo", upload.single("profileImage"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });

    const relPath = path.join("uploads", req.file.filename);
    const passenger = await Passenger.findByIdAndUpdate(
      req.params.id,
      { profileImage: relPath },
      { new: true }
    );
    if (!passenger) return res.status(404).json({ message: "Passenger not found" });

    const avatarUrl = "/" + relPath.replace(/\\/g, "/");
    const result = {
      ...passenger.toObject(),
      phone: passenger.phone || passenger.contact || null,
    };

    return res.status(200).json({ passenger: result, avatarUrl });
  } catch (err) {
    console.error("❌ Passenger photo error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

router.post(
  "/passenger/:id/discount/submit",
  upload.fields([
    { name: "idFront", maxCount: 1 },
    { name: "idBack", maxCount: 1 },
  ]),
  async (req, res) => {
    let frontPath = null;
    let backPath = null;

    try {
      const passengerId = req.params.id;
      const discountType = String(req.body?.discountType || "").trim();
      const schoolYear = String(req.body?.schoolYear || "").trim();

      if (!["Student", "Senior Citizen", "PWD"].includes(discountType)) {
        return res.status(400).json({ ok: false, message: "Invalid discountType" });
      }

      // required front image
      frontPath = req.files?.idFront?.[0]?.path || null;
      backPath = req.files?.idBack?.[0]?.path || null;

      if (!frontPath) {
        return res.status(400).json({ ok: false, message: "idFront image is required" });
      }

      // Student requires schoolYear
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

      // ✅ upload to Cloudinary
      const folder = `todago/passengers/${passengerId}/discount`;

      const frontUp = await uploadToCloudinary(frontPath, folder);
      let backUp = { url: null, publicId: null };
      if (backPath) {
        backUp = await uploadToCloudinary(backPath, folder);
      }

      // ✅ update passenger discountVerification
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
      // cleanup temp uploads (multer diskStorage)
      try {
        if (frontPath && fs.existsSync(frontPath)) fs.unlinkSync(frontPath);
        if (backPath && fs.existsSync(backPath)) fs.unlinkSync(backPath);
      } catch {}
    }
  }
);

// ✅ GET /api/passenger/:id/discount
router.get("/passenger/:id/discount", async (req, res) => {
  try {
    const p = await Passenger.findById(req.params.id).select("discountVerification").lean();
    if (!p) return res.status(404).json({ ok: false, message: "Passenger not found" });
    return res.json({ ok: true, discountVerification: p.discountVerification || null });
  } catch (e) {
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});


module.exports = router;
