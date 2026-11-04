const cron = require('node-cron');
const { Job } = require('../models');
const { sendAlert } = require('./notifier');
const { recordAudit } = require('./audit');
const { publishEvent } = require('../realtime/events');
const logger = require('../config/logger');

let cronTask = null;

/**
 * Checks for jobs that have breached their SLA deadline and emits alerts.
 * A job breaches SLA when deadlineAt < now, status is in [pending, running, retrying, failed],
 * and slaAlertedAt is null.
 *
 * @returns {Promise<number>} Count of jobs alerted
 */
async function runSlaCheck() {
  const now = new Date();

  const jobs = await Job.find({
    deadlineAt: { $lt: now },
    status: { $in: ['pending', 'running', 'retrying', 'failed'] },
    slaAlertedAt: null,
  }).populate('workflow', 'name slaMinutes');

  let alertedCount = 0;

  for (const job of jobs) {
    try {
      // If workflow has no SLA configured, do not alert
      if (!job.workflow || job.workflow.slaMinutes == null) {
        continue;
      }

      job.slaAlertedAt = new Date();
      await job.save();

      await publishEvent('sla.breached', {
        jobId: String(job._id),
        workflowId: String(job.workflow._id || job.workflow),
        workflowName: job.workflow?.name,
        deadlineAt: job.deadlineAt,
      });

      await sendAlert({
        type: 'sla_breached',
        message: `Job ${job._id} on workflow ${job.workflow.name} passed its SLA deadline`,
        data: {
          jobId: job._id,
          deadlineAt: job.deadlineAt,
          status: job.status,
        },
      });

      await recordAudit({
        action: 'job.sla_breached',
        entityType: 'job',
        entityId: job._id,
        actor: null,
        before: null,
        after: {
          deadlineAt: job.deadlineAt,
          status: job.status,
        },
      });

      alertedCount++;
    } catch (err) {
      logger.error({ jobId: job._id, err: err.message }, 'Error processing SLA breach');
    }
  }

  return alertedCount;
}

/**
 * Starts the node-cron scheduler running every minute.
 */
function startSlaScheduler() {
  if (cronTask) {
    return cronTask;
  }

  cronTask = cron.schedule('* * * * *', async () => {
    try {
      await runSlaCheck();
    } catch (err) {
      logger.error({ err: err.message }, 'Error during scheduled SLA check');
    }
  });

  logger.info('SLA checker scheduled every minute');
  return cronTask;
}

/**
 * Stops the node-cron scheduler cleanly.
 */
function stopSlaScheduler() {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}

module.exports = {
  runSlaCheck,
  startSlaScheduler,
  stopSlaScheduler,
};
