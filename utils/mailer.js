// utils/mailer.js
const sgMail = require('@sendgrid/mail');

function ensureSendgridReady() {
  const key = process.env.SENDGRID_API_KEY || '';
  const fromEmail = process.env.SMTP_FROM_EMAIL || '';
  console.log(SENDGRID_API_KEY)

  if (!key) throw new Error('SENDGRID_API_KEY not set');
  if (!key.startsWith('SG.')) throw new Error('SENDGRID_API_KEY must start with "SG."');
  if (!fromEmail) throw new Error('SMTP_FROM_EMAIL not set (must be a verified sender)');

  // set once
  if (!ensureSendgridReady._set) {
    sgMail.setApiKey(key);
    ensureSendgridReady._set = true;
  }
}

async function sendMail({ to, subject, html }) {
  ensureSendgridReady();
  if (!to) throw new Error("sendMail missing 'to'");

  const msg = {
    to,
    from: {
      email: process.env.SMTP_FROM_EMAIL,
      name: process.env.SMTP_FROM_NAME || 'TodaGo',
    },
    subject,
    html,
  };

  console.log('mailer → to:', to, 'from:', msg.from);
  const resp = await sgMail.send(msg);
  console.log('mailer → SendGrid status:', resp?.[0]?.statusCode);
  return resp;
}

module.exports = { sendMail };
