const Redis = require('ioredis');
const logger = require('../config/logger');

const REDIS_EVENTS_CHANNEL = 'taskwatch:events';

const EVENT_JOB_UPDATED = 'job.updated';
const EVENT_QUEUE_UPDATED = 'queue.updated';
const EVENT_SLA_BREACHED = 'sla.breached';

// Dedicated Redis publisher connection for realtime broadcast
const publisher = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
});

publisher.on('error', (err) => {
  logger.error({ err: err.message }, '[Realtime Publisher Error]');
});

/**
 * Publishes an event to the Redis pub/sub channel.
 * Log and swallow errors so the worker or caller never crashes because of realtime.
 *
 * @param {string} name - Event name ("job.updated", "queue.updated", "sla.breached")
 * @param {Object} payload - Event payload
 * @returns {Promise<void>}
 */
async function publishEvent(name, payload) {
  try {
    const message = JSON.stringify({
      name,
      payload,
      sentAt: new Date().toISOString(),
    });
    await publisher.publish(REDIS_EVENTS_CHANNEL, message);
  } catch (err) {
    logger.error({ name, err: err.message }, `[Realtime Publish Error] Failed to publish ${name}`);
  }
}

module.exports = {
  REDIS_EVENTS_CHANNEL,
  EVENT_JOB_UPDATED,
  EVENT_QUEUE_UPDATED,
  EVENT_SLA_BREACHED,
  publishEvent,
  publisher,
};
