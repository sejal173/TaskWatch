const mongoose = require('mongoose');

// Job schema tracking background execution, retry attempts, and SLA deadlines
const jobSchema = new mongoose.Schema(
  {
    workflow: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workflow',
      required: true,
    },
    task: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'succeeded', 'failed', 'retrying', 'dead_lettered', 'discarded'],
      default: 'pending',
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      required: true,
    },
    input: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    output: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    queueJobId: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    finishedAt: {
      type: Date,
      default: null,
    },
    deadlineAt: {
      type: Date,
      default: null,
    },
    slaAlertedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for SLA deadline monitoring and workflow execution history
jobSchema.index({ status: 1, deadlineAt: 1 });
jobSchema.index({ workflow: 1, createdAt: -1 });

const Job = mongoose.model('Job', jobSchema);

module.exports = Job;

