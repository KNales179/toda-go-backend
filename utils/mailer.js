const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function sendMail(to, subject, html) {
  const msg = {
    to,
    from: process.env.SMTP_FROM,  // must be your verified sender
    subject,
    html,
  };

  try {
    await sgMail.send(msg);
    console.log("✅ Email sent to", to);
  } catch (err) {
    console.error("❌ SendGrid error:", err.response?.body || err.message);
    throw err;
  }
}

module.exports = { sendMail };
