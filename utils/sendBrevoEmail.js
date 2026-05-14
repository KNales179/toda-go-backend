const brevo = require("@getbrevo/brevo");

const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.authentications.apiKey.apiKey = process.env.BREVO_API_KEY;

async function sendBrevoEmail({ to, subject, htmlContent, textContent }) {
  try {
    const sendSmtpEmail = new brevo.SendSmtpEmail();

    sendSmtpEmail.sender = {
      name: process.env.BREVO_SENDER_NAME || "TODA Go",
      email: process.env.BREVO_SENDER_EMAIL,
    };

    sendSmtpEmail.to = [{ email: to }];
    sendSmtpEmail.subject = subject;
    sendSmtpEmail.htmlContent = htmlContent;
    sendSmtpEmail.textContent = textContent;

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    return result;
  } catch (error) {
    console.error("❌ Brevo email error:", error?.response?.body || error?.body || error);
    throw error;
  }
}

module.exports = sendBrevoEmail;