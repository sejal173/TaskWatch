const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../middleware/auth');
const { jobQueue } = require('../queue/jobQueue');
const { recordAudit } = require('../services/audit');
const { publishEvent } = require('../realtime/events');
const logger = require('../config/logger');

const router = express.Router();

// GET /api/queues/stats: admin or operator
router.get('/stats', requireAuth, requireRole('admin', 'operator'), async (req, res) => {
  try {
    const counts = await jobQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    const paused = await jobQueue.isPaused();

    return res.status(200).json({
      name: jobQueue.name,
      paused,
      counts,
    });
  } catch (error) {
    logger.error({ err: error.message }, 'Error fetching queue stats');
    return res.status(500).json({ error: 'Server error retrieving queue statistics' });
  }
});

// POST /api/queues/pause: admin only
router.post('/pause', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await jobQueue.pause();

    await recordAudit({
      action: 'queue.paused',
      entityType: 'queue',
      entityId: null,
      actor: req.user._id,
      before: null,
      after: {
        name: jobQueue.name,
        paused: true,
      },
    });

    await publishEvent('queue.updated', { paused: true });

    return res.status(200).json({ paused: true });
  } catch (error) {
    logger.error('Error pausing queue: ' + error.message);
    return res.status(500).json({ error: error.message || 'Server error pausing queue' });
  }
});

// POST /api/queues/resume: admin only
router.post('/resume', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await jobQueue.resume();

    await recordAudit({
      action: 'queue.resumed',
      entityType: 'queue',
      entityId: null,
      actor: req.user._id,
      before: null,
      after: {
        name: jobQueue.name,
        paused: false,
      },
    });

    await publishEvent('queue.updated', { paused: false });

    return res.status(200).json({ paused: false });
  } catch (error) {
    logger.error('Error resuming queue: ' + error.message);
    return res.status(500).json({ error: error.message || 'Server error resuming queue' });
  }
});

module.exports = router;

