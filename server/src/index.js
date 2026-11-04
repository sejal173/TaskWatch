require('dotenv').config();
const http = require('http');
const express = require('express');
const pinoHttp = require('pino-http');
const mongoose = require('mongoose');
const logger = require('./config/logger');
const redisConnection = require('./config/redis');
const connectDB = require('./config/db');
const { initSocket } = require('./realtime/socket');
const { apiLimiter } = require('./middleware/rateLimit');

const authRouter = require('./routes/auth');
const workflowsRouter = require('./routes/workflows');
const tasksRouter = require('./routes/tasks');
const jobsRouter = require('./routes/jobs');
const auditRouter = require('./routes/audit');
const queuesRouter = require('./routes/queues');
const metricsRouter = require('./routes/metrics');

// Connect to MongoDB
connectDB();

const app = express();

// Pino HTTP middleware before routes
app.use(
  pinoHttp({
    logger,
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  })
);

// Body parser with 100kb limit
app.use(express.json({ limit: '100kb' }));

// General rate limiter for /api
app.use('/api', apiLimiter);

// Health check endpoints
app.get('/api/health/live', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/api/health', async (req, res) => {
  const mongoUp = mongoose.connection.readyState === 1;
  let redisUp = false;
  try {
    const pingPromise = redisConnection.ping();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 2000)
    );
    const pong = await Promise.race([pingPromise, timeoutPromise]);
    redisUp = pong === 'PONG';
  } catch {
    redisUp = false;
  }

  const isHealthy = mongoUp && redisUp;
  const status = isHealthy ? 'ok' : 'degraded';
  const body = {
    status,
    mongo: mongoUp ? 'up' : 'down',
    redis: redisUp ? 'up' : 'down',
    uptime: process.uptime(),
  };

  return res.status(isHealthy ? 200 : 503).json(body);
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/audit', auditRouter);
app.use('/api/queues', queuesRouter);
app.use('/api/metrics', metricsRouter);

// Centralized error handler
app.use((err, req, res, next) => {
  if (
    (err instanceof SyntaxError && err.status === 400 && 'body' in err) ||
    err.type === 'entity.parse.failed'
  ) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({ error: 'Request body too large' });
  }
  logger.error({ err: err.message }, 'Unhandled error');
  return res.status(err.status || 500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

const httpServer = http.createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
  logger.info(`Server listening on port ${PORT}`);
});
