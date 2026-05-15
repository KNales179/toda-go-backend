//sendEmailOtp.js
const sendBrevoEmail = require("./sendBrevoEmail");

async function sendEmailOtp({ to, otp, name = "there" }) {
  const safeName = name || "there";

  const subject = "Your TODA Go verification code";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="color: #2563eb; margin-bottom: 8px;">TODA Go Email Verification</h2>

      <p>Hello ${safeName},</p>

      <p>Use the verification code below to verify your TODA Go account:</p>

      <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 18px; background: #f3f4f6; border-radius: 10px; margin: 24px 0;">
        ${otp}
      </div>

      <p>This code will expire in <strong>10 minutes</strong>.</p>

      <p>If you did not request this code, you can ignore this email.</p>

      <p style="margin-top: 24px; font-size: 12px; color: #6b7280;">
        TODA Go | TFRO Lucena
      </p>
    </div>
  `;

  const textContent = `
Hello ${safeName},

Your TODA Go verification code is: ${otp}

This code will expire in 10 minutes.

If you did not request this code, you can ignore this email.
  `;

  return sendBrevoEmail({
    to,
    subject,
    htmlContent,
    textContent,
  });
}

module.exports = sendEmailOtp;