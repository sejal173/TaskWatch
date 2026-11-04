const Redis = require('ioredis');
require('dotenv').config();
const logger = require('./logger');

// Shared Redis connection for BullMQ queue and worker
const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  maxRetriesPerRequest: null, // Required by BullMQ
});

redisConnection.on('error', (err) => {
  logger.error({ err: err.message }, 'Redis connection error');
});

module.exports = redisConnection;

