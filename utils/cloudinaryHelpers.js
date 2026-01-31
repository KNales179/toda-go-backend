const cloudinary = require("./cloudinaryConfig");

async function safeDestroy(publicId) {
  if (!publicId) return { result: "skipped" };
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    console.error("❌ Cloudinary destroy failed:", publicId, e?.message);
    return { result: "error", error: e?.message };
  }
}

module.exports = { safeDestroy };
