// TOP of file
const upload = require("../middleware/upload");
const path = require("path");

// UPDATE text fields (no images)
// PATCH /api/passenger/:id
router.patch("/passenger/:id", async (req, res) => {
  try {
    const allowed = ["firstName", "middleName", "lastName", "birthday", "email", "phone"]; // add more if your model has them
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

    const passenger = await Passenger.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!passenger) return res.status(404).json({ message: "Passenger not found" });
    res.status(200).json({ passenger });
  } catch (err) {
    console.error("❌ Passenger update error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// UPLOAD profile image (field name MUST be 'profileImage')
// POST /api/passenger/:id/photo
router.post("/passenger/:id/photo", upload.single("profileImage"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No image uploaded" });

    // Save path like "uploads/12345-name.jpg"
    const relPath = path.join("uploads", req.file.filename);
    const passenger = await Passenger.findByIdAndUpdate(
      req.params.id,
      { profileImage: relPath },
      { new: true }
    );
    if (!passenger) return res.status(404).json({ message: "Passenger not found" });

    res.status(200).json({ passenger, avatarUrl: `/${relPath.replace(/\\/g, "/")}` });
  } catch (err) {
    console.error("❌ Passenger photo error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
