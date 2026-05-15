//sendBrevoEmail.js
async function sendBrevoEmail({ to, subject, htmlContent, textContent }) {
  try {
    if (!process.env.BREVO_API_KEY) {
      throw new Error("BREVO_API_KEY is missing in environment variables.");
    }

    if (!process.env.BREVO_SENDER_EMAIL) {
      throw new Error("BREVO_SENDER_EMAIL is missing in environment variables.");
    }

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          name: process.env.BREVO_SENDER_NAME || "TODA Go",
          email: process.env.BREVO_SENDER_EMAIL,
        },
        to: [{ email: to }],
        subject,
        htmlContent,
        textContent,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("❌ Brevo API error:", data);

      const message =
        data?.message ||
        data?.code ||
        "Failed to send Brevo email.";

      throw new Error(message);
    }

    return data;
  } catch (error) {
    console.error("❌ sendBrevoEmail error:", error.message || error);
    throw error;
  }
}

module.exports = sendBrevoEmail;