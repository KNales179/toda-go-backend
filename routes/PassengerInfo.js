// routes/PassengerInfo.js
const express = require("express");
const router = express.Router();
const Passenger = require("../models/Passenger");
const upload = require("../middleware/upload");
const path = require("path");

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

module.exports = router;
