const mongoose = require('mongoose');

// Subdocument schema for individual workflow steps
const stepSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  order: {
    type: Number,
    required: true,
  },
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
  },
});

// Subdocument schema for workflow execution retry policy
const retryPolicySchema = new mongoose.Schema(
  {
    maxAttempts: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
    backoff: {
      type: String,
      enum: ['fixed', 'exponential'],
      default: 'exponential',
    },
    delayMs: {
      type: Number,
      default: 5000,
      min: 0,
    },
  },
  { _id: false }
);

// Workflow schema defining automated task pipelines and policies
const workflowSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    steps: [stepSchema],
    retryPolicy: {
      type: retryPolicySchema,
      default: () => ({}),
    },
    slaMinutes: {
      type: Number,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
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

const Workflow = mongoose.model('Workflow', workflowSchema);

module.exports = Workflow;

