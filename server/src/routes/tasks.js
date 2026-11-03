const express = require('express');
const mongoose = require('mongoose');
const { Task, Workflow, User } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();

const VALID_STATUSES = ['pending', 'in_progress', 'done', 'failed'];

// GET /api/tasks: any logged-in user
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

    if (req.query.assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(req.query.assignedTo)) {
        return res.status(400).json({ error: 'Invalid assignedTo user ID format' });
      }
      filter.assignedTo = req.query.assignedTo;
    }

    if (req.query.status) {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      filter.status = req.query.status;
    }

    const [items, total] = await Promise.all([
      Task.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate('workflow', 'name')
        .populate('assignedTo', 'name email'),
      Task.countDocuments(filter),
    ]);

    return res.status(200).json({ items, total, page, limit });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    return res.status(500).json({ error: 'Server error fetching tasks' });
  }
});

// POST /api/tasks: admin or operator
router.post('/', requireAuth, requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { workflow, title, assignedTo, dueAt } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Task title is required' });
    }

    if (!workflow || !mongoose.Types.ObjectId.isValid(workflow)) {
      return res.status(400).json({ error: 'Valid workflow ID is required' });
    }

    // Verify workflow exists and is active
    const wf = await Workflow.findById(workflow);
    if (!wf || !wf.isActive) {
      return res.status(400).json({ error: 'Workflow does not exist or is inactive' });
    }

    // Verify assignedTo user exists and is active if provided
    if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(assignedTo)) {
        return res.status(400).json({ error: 'Invalid assignedTo user ID' });
      }
      const assignedUser = await User.findById(assignedTo);
      if (!assignedUser || !assignedUser.isActive) {
        return res.status(400).json({ error: 'Assigned user does not exist or is inactive' });
      }
    }

    const task = await Task.create({
      workflow,
      title: title.trim(),
      assignedTo: assignedTo || null,
      dueAt: dueAt || null,
      createdBy: req.user._id,
    });

    await recordAudit({
      action: 'task.created',
      entityType: 'task',
      entityId: task._id,
      actor: req.user._id,
      before: null,
      after: task.toObject(),
    });

    return res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    return res.status(500).json({ error: error.message || 'Server error creating task' });
  }
});

// PATCH /api/tasks/:id: admin or operator
router.patch('/:id', requireAuth, requireRole('admin', 'operator'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid task ID format' });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { title, status, assignedTo, dueAt } = req.body;

    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'Task title must be a non-empty string' });
      }
      task.title = title.trim();
    }

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
      }
      task.status = status;
    }

    if (assignedTo !== undefined) {
      if (assignedTo === null) {
        task.assignedTo = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(assignedTo)) {
          return res.status(400).json({ error: 'Invalid assignedTo user ID' });
        }
        const assignedUser = await User.findById(assignedTo);
        if (!assignedUser || !assignedUser.isActive) {
          return res.status(400).json({ error: 'Assigned user does not exist or is inactive' });
        }
        task.assignedTo = assignedTo;
      }
    }

    if (dueAt !== undefined) {
      task.dueAt = dueAt;
    }

    const beforeObj = task.toObject();
    await task.save();
    const afterObj = task.toObject();

    await recordAudit({
      action: 'task.updated',
      entityType: 'task',
      entityId: task._id,
      actor: req.user._id,
      before: beforeObj,
      after: afterObj,
    });

    return res.status(200).json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    return res.status(500).json({ error: error.message || 'Server error updating task' });
  }
});

// DELETE /api/tasks/:id: admin only (hard delete)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid task ID format' });
    }

    const task = await Task.findById(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const beforeObj = task.toObject();
    await Task.deleteOne({ _id: task._id });

    await recordAudit({
      action: 'task.deleted',
      entityType: 'task',
      entityId: task._id,
      actor: req.user._id,
      before: beforeObj,
      after: null,
    });

    return res.status(200).json({ message: 'Task deleted' });
  } catch (error) {
    console.error('Error deleting task:', error);
    return res.status(500).json({ error: 'Server error deleting task' });
  }
});

module.exports = router;

