const express = require('express');
const mongoose = require('mongoose');
const { Workflow } = require('../models');
const { requireAuth, requireRole } = require('../middleware/auth');
const { recordAudit } = require('../services/audit');

const router = express.Router();

// Helper to validate steps array
const validateSteps = (steps) => {
  if (!Array.isArray(steps) || steps.length === 0) {
    return 'Steps must be an array with at least one step';
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== 'object' || !step.name || typeof step.name !== 'string' || !step.name.trim()) {
      return `Step at index ${i} must have a valid name`;
    }
    if (typeof step.order !== 'number' || isNaN(step.order)) {
      return `Step at index ${i} must have a numeric order`;
    }
  }

  const orders = steps.map((s) => s.order);
  if (new Set(orders).size !== orders.length) {
    return 'Duplicate step order values are not allowed';
  }

  return null;
};

// GET /api/workflows: any logged-in user
router.get('/', requireAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    const includeInactive = req.query.includeInactive === 'true' && req.user.role === 'admin';
    if (!includeInactive) {
      filter.isActive = true;
    }

    const [items, total] = await Promise.all([
      Workflow.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Workflow.countDocuments(filter),
    ]);

    return res.status(200).json({ items, total, page, limit });
  } catch (error) {
    console.error('Error fetching workflows:', error);
    return res.status(500).json({ error: 'Server error fetching workflows' });
  }
});

// GET /api/workflows/:id: any logged-in user
router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid workflow ID format' });
    }

    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    return res.status(200).json(workflow);
  } catch (error) {
    console.error('Error fetching workflow:', error);
    return res.status(500).json({ error: 'Server error fetching workflow' });
  }
});

// POST /api/workflows: admin or operator
router.post('/', requireAuth, requireRole('admin', 'operator'), async (req, res) => {
  try {
    const { name, description, steps, retryPolicy, slaMinutes } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Workflow name is required' });
    }

    const stepsError = validateSteps(steps);
    if (stepsError) {
      return res.status(400).json({ error: stepsError });
    }

    const workflowData = {
      name: name.trim(),
      description: typeof description === 'string' ? description : '',
      steps,
      createdBy: req.user._id,
    };

    if (retryPolicy !== undefined) workflowData.retryPolicy = retryPolicy;
    if (slaMinutes !== undefined) workflowData.slaMinutes = slaMinutes;

    const workflow = await Workflow.create(workflowData);

    await recordAudit({
      action: 'workflow.created',
      entityType: 'workflow',
      entityId: workflow._id,
      actor: req.user._id,
      before: null,
      after: workflow.toObject(),
    });

    return res.status(201).json(workflow);
  } catch (error) {
    console.error('Error creating workflow:', error);
    return res.status(500).json({ error: error.message || 'Server error creating workflow' });
  }
});

// PATCH /api/workflows/:id: admin or operator
router.patch('/:id', requireAuth, requireRole('admin', 'operator'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid workflow ID format' });
    }

    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const { name, description, steps, retryPolicy, slaMinutes, isActive } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Workflow name must be a non-empty string' });
      }
      workflow.name = name.trim();
    }

    if (description !== undefined) {
      workflow.description = typeof description === 'string' ? description : '';
    }

    if (steps !== undefined) {
      const stepsError = validateSteps(steps);
      if (stepsError) {
        return res.status(400).json({ error: stepsError });
      }
      workflow.steps = steps;
    }

    if (retryPolicy !== undefined) {
      workflow.retryPolicy = retryPolicy;
    }

    if (slaMinutes !== undefined) {
      workflow.slaMinutes = slaMinutes;
    }

    if (isActive !== undefined) {
      workflow.isActive = Boolean(isActive);
    }

    const beforeObj = workflow.toObject();
    await workflow.save();
    const afterObj = workflow.toObject();

    await recordAudit({
      action: 'workflow.updated',
      entityType: 'workflow',
      entityId: workflow._id,
      actor: req.user._id,
      before: beforeObj,
      after: afterObj,
    });

    return res.status(200).json(workflow);
  } catch (error) {
    console.error('Error updating workflow:', error);
    return res.status(500).json({ error: error.message || 'Server error updating workflow' });
  }
});

// DELETE /api/workflows/:id: admin only (soft delete)
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Invalid workflow ID format' });
    }

    const workflow = await Workflow.findById(req.params.id);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }

    const beforeObj = workflow.toObject();
    workflow.isActive = false;
    await workflow.save();

    await recordAudit({
      action: 'workflow.deleted',
      entityType: 'workflow',
      entityId: workflow._id,
      actor: req.user._id,
      before: beforeObj,
      after: null,
    });

    return res.status(200).json(workflow);
  } catch (error) {
    console.error('Error deleting workflow:', error);
    return res.status(500).json({ error: 'Server error deleting workflow' });
  }
});

module.exports = router;

