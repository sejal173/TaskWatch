const express = require('express');
const mongoose = require('mongoose');
const { Job, Workflow, Task } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { enqueueJob } = require('../queue/jobQueue');
const { recordAudit } = require('../services/audit');

const router = express.Router();

// POST /api/jobs: admin or operator
router.post('/', requireAuth, requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { workflow, task, input } = req.body;

    if (!workflow || !mongoose.Types.ObjectId.isValid(workflow)) {
      return res.status(400).json({ error: 'Valid workflow ID is required' });
    }

    // Verify workflow exists and is active
    const wf = await Workflow.findById(workflow);
    if (!wf || !wf.isActive) {
      return res.status(400).json({ error: 'Workflow does not exist or is inactive' });
    }

    // Verify task if provided
    let taskDoc = null;
    if (task) {
      if (!mongoose.Types.ObjectId.isValid(task)) {
        return res.status(400).json({ error: 'Invalid task ID format' });
      }
      taskDoc = await Task.findById(task);
      if (!taskDoc || String(taskDoc.workflow) !== String(wf._id)) {
        return res.status(400).json({
          error: 'Task does not exist or does not belong to the specified workflow',
        });
      }
    }

    // Calculate deadlineAt from workflow slaMinutes
    let deadlineAt = null;
    if (typeof wf.slaMinutes === 'number' && wf.slaMinutes > 0) {
      deadlineAt = new Date(Date.now() + wf.slaMinutes * 60 * 1000);
    }

    const maxAttempts =
      wf.retryPolicy && typeof wf.retryPolicy.maxAttempts === 'number'
        ? wf.retryPolicy.maxAttempts
        : 3;

    // Create MongoDB Job
    const job = await Job.create({
      workflow: wf._id,
      task: taskDoc ? taskDoc._id : null,
      input: input || {},
      status: 'pending',
      maxAttempts,
      deadlineAt,
      createdBy: req.user._id,
    });

    // Enqueue job into BullMQ using workflow retryPolicy
    await enqueueJob(job, wf.retryPolicy);

    // Record audit event
    await recordAudit({
      action: 'job.created',
      entityType: 'job',
      entityId: job._id,
      actor: req.user._id,
      before: null,
      after: job.toObject(),
    });

    return res.status(201).json(job);
  } catch (error) {
    console.error('Error creating job:', error);
    return res.status(500).json({ error: error.message || 'Server error creating job' });
  }
});

// GET /api/jobs: any logged-in user
router.get('/', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.workflow) {
      if (!mongoose.Types.ObjectId.isValid(req.query.workflow)) {
        return res.status(400).json({ error: 'Invalid workflow ID format' });
      }
      filter.workflow = req.query.workflow;
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    if (req.query.slaBreached === 'true') {
      filter.slaAlertedAt = { $ne: null };
    }

    const [items, total] = await Promise.all([
      Job.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate('workflow', 'name')
        .populate('task', 'title'),
      Job.countDocuments(filter),
    ]);

    return res.status(200).json({ items, total, page, limit });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return res.status(500).json({ error: 'Server error fetching jobs' });
  }
});

// GET /api/jobs/:id: any logged-in user
router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const job = await Job.findById(req.params.id)
      .populate('workflow', 'name')
      .populate('task', 'title');

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.status(200).json(job);
  } catch (error) {
    console.error('Error fetching job:', error);
    return res.status(500).json({ error: 'Server error fetching job' });
  }
});

// POST /api/jobs/:id/replay: admin or operator
router.post('/:id/replay', requireAuth, requireRole('admin', 'operator'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'dead_lettered') {
      return res.status(400).json({ error: 'Only dead_lettered jobs can be replayed' });
    }

    const wf = await Workflow.findById(job.workflow);
    if (!wf || !wf.isActive) {
      return res.status(400).json({ error: 'Workflow does not exist or is inactive' });
    }

    const beforeObj = job.toObject();

    // Reset attempts to 0, status to pending, clear lastError and finishedAt
    job.attempts = 0;
    job.status = 'pending';
    job.lastError = null;
    job.finishedAt = null;
    await job.save();

    const replayJobId = `${job._id}-replay-${Date.now()}`;
    await enqueueJob(job, wf.retryPolicy, replayJobId);

    await recordAudit({
      action: 'job.replayed',
      entityType: 'job',
      entityId: job._id,
      actor: req.user._id,
      before: beforeObj,
      after: job.toObject(),
    });

    return res.status(200).json(job);
  } catch (error) {
    console.error('Error replaying job:', error);
    return res.status(500).json({ error: error.message || 'Server error replaying job' });
  }
});

// POST /api/jobs/:id/discard: admin or operator
router.post('/:id/discard', requireAuth, requireRole('admin', 'operator'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.status !== 'dead_lettered') {
      return res.status(400).json({ error: 'Only dead_lettered jobs can be discarded' });
    }

    const beforeObj = job.toObject();
    job.status = 'discarded';
    await job.save();

    await recordAudit({
      action: 'job.discarded',
      entityType: 'job',
      entityId: job._id,
      actor: req.user._id,
      before: beforeObj,
      after: job.toObject(),
    });

    return res.status(200).json(job);
  } catch (error) {
    console.error('Error discarding job:', error);
    return res.status(500).json({ error: error.message || 'Server error discarding job' });
  }
});

module.exports = router;
