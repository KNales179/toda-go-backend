// src/utils/mailer.js
const sgMail = require('@sendgrid/mail');

function ensureSendgridReady() {
  const key = process.env.SENDGRID_API_KEY || '';
  const fromEmail = process.env.SMTP_FROM_EMAIL || '';
  const fromName = process.env.SMTP_FROM_NAME || 'TodaGo';

  if (!key) throw new Error('SENDGRID_API_KEY not set (env)');
  if (!key.startsWith('SG.')) throw new Error('SENDGRID_API_KEY must start with "SG."');
  if (!fromEmail) throw new Error('SMTP_FROM_EMAIL not set (env)');

  if (!ensureSendgridReady._set) {
    sgMail.setApiKey(key);
    ensureSendgridReady._set = true;
    console.log('[mailer] ready:', { fromEmail, fromName });
  }
}

async function sendMail({ to, subject, html, text }) {
  ensureSendgridReady();
  if (!to) throw new Error("sendMail missing 'to'");

  const msg = {
    to,
    from: { email: process.env.SMTP_FROM_EMAIL, name: process.env.SMTP_FROM_NAME || 'TodaGo' },
    subject,
    html,
    ...(text ? { text } : {}),
  };

  console.log('[mailer] sending →', { to: msg.to, subject: msg.subject });
  const resp = await sgMail.send(msg);
  console.log('[mailer] status:', resp?.[0]?.statusCode);
  return resp;
}

module.exports = { sendMail };
