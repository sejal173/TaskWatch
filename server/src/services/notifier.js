/**
 * SLA breach and operational notification service
 */

async function sendAlert({ type, message, data }) {
  console.log(`[ALERT] ${type}: ${message}`);

  const webhookUrl = process.env.SLA_WEBHOOK_URL;
  if (!webhookUrl) {
    return;
  }

  try {
    const payload = {
      type,
      message,
      data,
      sentAt: new Date().toISOString(),
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`Failed to send webhook alert to ${webhookUrl}:`, err.message);
  }
}

module.exports = {
  sendAlert,
};

