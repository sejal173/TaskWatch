const express = require('express');
const mongoose = require('mongoose');
const { requireAuth, requireRole } = require('../middleware/auth');
const { jobQueue } = require('../queue/jobQueue');
const { recordAudit } = require('../services/audit');

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
    console.error('Error fetching queue stats:', error);
    return res.status(500).json({ error: 'Server error retrieving queue statistics' });
  }
});

// POST /api/queues/pause: admin only
router.post('/pause', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await jobQueue.pause();

    // AuditEvent entityId is required by model, so generate a new ObjectId for queue events
    await recordAudit({
      action: 'queue.paused',
      entityType: 'job',
      entityId: new mongoose.Types.ObjectId(),
      actor: req.user._id,
      before: null,
      after: {
        queue: jobQueue.name,
        paused: true,
      },
    });

    return res.status(200).json({ paused: true });
  } catch (error) {
    console.error('Error pausing queue:', error);
    return res.status(500).json({ error: error.message || 'Server error pausing queue' });
  }
});

// POST /api/queues/resume: admin only
router.post('/resume', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    await jobQueue.resume();

    // AuditEvent entityId is required by model, so generate a new ObjectId for queue events
    await recordAudit({
      action: 'queue.resumed',
      entityType: 'job',
      entityId: new mongoose.Types.ObjectId(),
      actor: req.user._id,
      before: null,
      after: {
        queue: jobQueue.name,
        paused: false,
      },
    });

    return res.status(200).json({ paused: false });
  } catch (error) {
    console.error('Error resuming queue:', error);
    return res.status(500).json({ error: error.message || 'Server error resuming queue' });
  }
});

module.exports = router;

