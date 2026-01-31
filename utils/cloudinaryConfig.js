const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

async function safeDestroy(publicId) {
  if (!publicId) return { result: "skipped" };
  try {
    return await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    console.error("❌ Cloudinary destroy failed:", publicId, e?.message);
    return { result: "error", error: e?.message };
  }
}

module.exports = { cloudinary, safeDestroy };
