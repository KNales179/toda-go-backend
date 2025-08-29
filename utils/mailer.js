const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing env: ${name}`);
}

requireEnv("SMTP_FROM_EMAIL");

async function sendMail({ to, subject, html }) {
  if (!to) throw new Error("sendMail missing 'to'");
  const msg = {
    to,
    from: {
      email: process.env.SMTP_FROM_EMAIL,    
      name: process.env.SMTP_FROM_NAME || "TodaGo",
    },
    subject,
    html,
  };

  console.log("mailer → to:", to, "from:", msg.from);
  try {
    const resp = await sgMail.send(msg);
    console.log("mailer → SG status:", resp[0]?.statusCode);
    return resp;
  } catch (err) {
    console.error("❌ SendGrid error:", err.response?.body || err.message);
    throw err;
  }
}

module.exports = { sendMail };
