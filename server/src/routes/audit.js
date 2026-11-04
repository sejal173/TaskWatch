const express = require('express');
const mongoose = require('mongoose');
const { AuditEvent } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_ENTITY_TYPES = ['workflow', 'task', 'job', 'user', 'queue', 'system'];

/**
 * Deep recursive scrubber to guarantee passwordHash never leaks in audit logs
 */
function scrubSensitiveData(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(scrubSensitiveData);

  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'passwordHash') continue;
    clean[key] = typeof value === 'object' && value !== null ? scrubSensitiveData(value) : value;
  }
  return clean;
}

// GET /api/audit: admin only
router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const filter = {};

    // Validate entityType if provided
    if (req.query.entityType) {
      if (!VALID_ENTITY_TYPES.includes(req.query.entityType)) {
        return res.status(400).json({
          error: `Invalid entityType. Must be one of: ${VALID_ENTITY_TYPES.join(', ')}`,
        });
      }
      filter.entityType = req.query.entityType;
    }

    // Validate entityId if provided
    if (req.query.entityId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.entityId)) {
        return res.status(400).json({ error: 'Invalid entityId format' });
      }
      filter.entityId = req.query.entityId;
    }

    // Exact match action filter
    if (req.query.action) {
      filter.action = req.query.action.trim();
    }

    // Validate actor if provided
    if (req.query.actor) {
      if (!mongoose.Types.ObjectId.isValid(req.query.actor)) {
        return res.status(400).json({ error: 'Invalid actor ID format' });
      }
      filter.actor = req.query.actor;
    }

    // Pagination
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const [rawItems, total] = await Promise.all([
      AuditEvent.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('actor', 'name email'),
      AuditEvent.countDocuments(filter),
    ]);

    // Convert to plain objects with string ObjectIds and scrub sensitive data
    const items = rawItems.map((item) =>
      scrubSensitiveData(JSON.parse(JSON.stringify(item)))
    );

    return res.status(200).json({ items, total, page, limit });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).json({ error: 'Server error fetching audit events' });
  }
});

module.exports = router;
