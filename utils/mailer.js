// utils/mailer.js
const sgMail = require("@sendgrid/mail");

if (!process.env.SENDGRID_API_KEY) throw new Error("Missing env SENDGRID_API_KEY");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);
if (!process.env.SENDGRID_API_KEY.startsWith("SG.")) {
  throw new Error("SENDGRID_API_KEY is invalid (must start with 'SG.')");
}
if (!process.env.SMTP_FROM_EMAIL) throw new Error("Missing env SMTP_FROM_EMAIL");

async function sendMail({ to, subject, html }) {
  if (!to) throw new Error("sendMail missing 'to'");

  const msg = {
    to,
    from: { email: process.env.SMTP_FROM_EMAIL, name: process.env.SMTP_FROM_NAME || "TodaGo" },
    subject,
    html,
  };

  console.log("mailer → to:", to, "from:", msg.from);
  const resp = await sgMail.send(msg);
  console.log("mailer → SendGrid status:", resp?.[0]?.statusCode);
  return resp;
}

module.exports = { sendMail };
