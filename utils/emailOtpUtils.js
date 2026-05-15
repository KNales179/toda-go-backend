// emailOtpUtils.js
const crypto = require("crypto");

function generateEmailOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function hashEmailOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

function getEmailOtpExpiry() {
  return new Date(Date.now() + 10 * 60 * 1000);
}

function canResendOtp(lastSentAt) {
  if (!lastSentAt) return true;

  const cooldownMs = 60 * 1000;
  const lastSentTime = new Date(lastSentAt).getTime();

  return Date.now() - lastSentTime >= cooldownMs;
}

module.exports = {
  generateEmailOtp,
  hashEmailOtp,
  getEmailOtpExpiry,
  canResendOtp,
};