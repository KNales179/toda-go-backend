// TOP of file
const upload = require("../middleware/upload");
const path = require("path");

// UPDATE text fields (no images)
// PATCH /api/driver/:id
router.patch("/driver/:id", async (req, res) => {
  try {
    const allowed = [
      "driverFirstName","driverMiddleName","driverLastName","driverName",
      "email","driverPhone","todaName","franchiseNumber","sector",
      "experienceYears","capacity","gender","driverBirthdate"
    ];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

    const driver = await Driver.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!driver) return res.status(404).json({ message: "Driver not found" });
    res.status(200).json({ driver });
  } catch (err) {
    console.error("❌ Driver update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// UPLOAD selfie image (field name MUST be 'selfieImage')
// POST /api/driver/:id/photo
router.post("/driver/:id/photo", upload.single("selfieImage"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    const relPath = path.join("uploads", req.file.filename); // e.g. uploads/123.jpg
    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { selfieImage: relPath },
      { new: true }
    );
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    // Build a forward-slash URL your RN app can render
    const avatarUrl = "/" + relPath.replace(/\\/g, "/"); // -> /uploads/123.jpg
    return res.status(200).json({ driver, avatarUrl });
  } catch (err) {
    console.error("❌ Driver photo error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});
