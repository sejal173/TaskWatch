const { recordAudit } = require('./audit');
const { publishEvent } = require('../realtime/events');

/**
 * Allowed transitions map for Job status lifecycle.
 * Real Job statuses from models/Job.js:
 * ['pending', 'running', 'succeeded', 'failed', 'retrying', 'dead_lettered', 'discarded']
 */
const ALLOWED = {
  pending: ['running'],
  running: ['succeeded', 'retrying', 'dead_lettered', 'failed'],
  retrying: ['running', 'dead_lettered'],
  dead_lettered: ['pending', 'discarded'],
  succeeded: [],
  failed: [],
  discarded: [],
};

/**
 * Centralized state transition for Job documents.
 * Validates transition against ALLOWED map, saves the job document,
 * writes an AuditEvent, and emits realtime 'job.updated' event.
 *
 * @param {import('../models/Job')} jobDoc - Mongoose Job document
 * @param {string} to - Destination status
 * @param {Object} [options]
 * @param {string|null} [options.actor=null] - Actor ObjectId or null
 * @param {Object} [options.meta={}] - Additional metadata to record in audit event
 * @returns {Promise<import('../models/Job')>}
 */
async function transitionJob(jobDoc, to, { actor = null, meta = {} } = {}) {
  const from = jobDoc.status;

  if (!ALLOWED[from] || !ALLOWED[from].includes(to)) {
    throw new Error(`Invalid job transition from "${from}" to "${to}"`);
  }

  jobDoc.status = to;
  await jobDoc.save();

  await recordAudit({
    action: meta?.action || `job.${to}`,
    entityType: 'job',
    entityId: jobDoc._id,
    actor: actor || null,
    before: { status: from },
    after: {
      ...jobDoc.toObject(),
      from,
      to,
      ...(meta || {}),
    },
  });

  await publishEvent('job.updated', {
    jobId: String(jobDoc._id),
    status: jobDoc.status,
    attempts: jobDoc.attempts,
    lastError: jobDoc.lastError,
    workflowId: String(jobDoc.workflow),
  });

  return jobDoc;
}

module.exports = {
  ALLOWED,
  transitionJob,
};

