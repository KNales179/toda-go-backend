// utils/media.js
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("./cloudinaryConfig");

const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, 
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

module.exports = { uploadMem, uploadBufferToCloudinary };
