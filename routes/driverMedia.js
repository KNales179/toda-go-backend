// routes/driverMedia.js
const router = require("express").Router();
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("../utils/cloudinaryConfig");
const Driver = require("../models/Drivers");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

function uploadBufferToCloudinary(buffer, options = {}) {
  return new Promise((resolve, reject) => {
    const up = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    streamifier.createReadStream(buffer).pipe(up);
  });
}

router.post("/:driverId/photo/selfie", upload.single("selfie"), async (req, res) => {
  try {
    const { driverId } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Missing selfie file" });

    const driver = await Driver.findById(driverId);
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    // delete old selfie if exists
    if (driver.selfieImagePublicId) {
      try { await cloudinary.uploader.destroy(driver.selfieImagePublicId); } catch (_) {}
    }

    // upload new selfie
    const r = await uploadBufferToCloudinary(file.buffer, {
      folder: "toda-go/selfies",
      resource_type: "image",
      transformation: [{ quality: "auto" }, { fetch_format: "auto" }],
    });

    // save new fields
    driver.selfieImage = r.secure_url;
    driver.selfieImagePublicId = r.public_id;
    await driver.save();

    // hide password
    if (driver.password) driver.password = undefined;

    return res.json({ ok: true, driver });
  } catch (e) {
    console.error("selfie replace error:", e);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

module.exports = router;
