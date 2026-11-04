const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Redis = require('ioredis');
const logger = require('../config/logger');
const { REDIS_EVENTS_CHANNEL } = require('./events');

let io = null;
let subscriber = null;

/**
 * Initializes Socket.IO server with JWT authentication and Redis subscriber forwarding.
 *
 * @param {import('http').Server} httpServer
 * @returns {Server}
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: 'http://localhost:5173',
      credentials: true,
    },
  });

  // Authenticate socket connections using JWT
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication token required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.data = { id: decoded.id, role: decoded.role };
      next();
    } catch (err) {
      return next(new Error('Invalid token'));
    }
  });

  // Dedicated Redis subscriber connection
  subscriber = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  });

  subscriber.on('error', (err) => {
    logger.error({ err: err.message }, '[Realtime Subscriber Error]');
  });

  subscriber.subscribe(REDIS_EVENTS_CHANNEL, (err) => {
    if (err) {
      logger.error({ channel: REDIS_EVENTS_CHANNEL, err: err.message }, `Failed to subscribe to ${REDIS_EVENTS_CHANNEL}`);
    }
  });

  // Forward incoming Redis events to all connected authenticated browsers
  subscriber.on('message', (channel, message) => {
    if (channel === REDIS_EVENTS_CHANNEL && io) {
      try {
        const { name, payload } = JSON.parse(message);
        io.emit(name, payload);
      } catch (err) {
        logger.error({ err: err.message }, 'Failed to parse realtime Redis message');
      }
    }
  });

  logger.info('Socket.IO ready');
  return io;
}

function getIo() {
  return io;
}

module.exports = {
  initSocket,
  getIo,
};
