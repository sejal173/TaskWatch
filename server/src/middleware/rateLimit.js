const rateLimit = require('express-rate-limit');

const authRateLimitMax = parseInt(process.env.AUTH_RATE_LIMIT_MAX, 10) || 10;
const apiRateLimitMax = parseInt(process.env.API_RATE_LIMIT_MAX, 10) || 300;

/**
 * Rate limiter for sensitive authentication endpoints (login, register):
 * 10 requests per 15 minutes per IP and identity by default.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const email =
      req.body && typeof req.body.email === 'string'
        ? req.body.email.trim().toLowerCase()
        : '';
    return `${req.ip}_${email}`;
  },
  handler: (req, res) => {
    return res.status(429).json({ error: 'Too many attempts, try again later' });
  },
});

/**
 * General rate limiter for all /api routes:
 * 300 requests per minute per IP by default.
 */
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: apiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json({ error: 'Too many requests, try again later' });
  },
});

module.exports = {
  authLimiter,
  apiLimiter,
};
