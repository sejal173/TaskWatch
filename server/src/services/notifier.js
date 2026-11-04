/**
 * SLA breach and operational notification service
 */
const logger = require('../config/logger');

async function sendAlert({ type, message, data }) {
  logger.info({ type, data }, `[ALERT] ${type}: ${message}`);

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
    logger.error({ webhookUrl, err: err.message }, `Failed to send webhook alert to ${webhookUrl}`);
  }
}

module.exports = {
  sendAlert,
};
