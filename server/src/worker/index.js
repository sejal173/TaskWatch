require('dotenv').config();
const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const connectDB = require('../config/db');
const redisConnection = require('../config/redis');
const logger = require('../config/logger');
const { Job, Workflow } = require('../models');
const { runWorkflowSteps } = require('./stepRunner');
const { transitionJob } = require('../services/transition');
const { startSlaScheduler, stopSlaScheduler } = require('../services/slaChecker');

// Connect to MongoDB
connectDB();

// Start SLA breach monitoring scheduler
startSlaScheduler();

/**
 * Helper to determine if an error can be retried.
 * Returns false when err.code is 'INVALID_PAYLOAD' or the error message contains 'INVALID_PAYLOAD'.
 *
 * @param {Error|any} err
 * @returns {boolean}
 */
function isRetryable(err) {
  if (!err) return true;
  if (err.code === 'INVALID_PAYLOAD') return false;
  if (typeof err.message === 'string' && err.message.includes('INVALID_PAYLOAD')) {
    return false;
  }
  return true;
}

// Initialize BullMQ Worker for workflow-jobs queue
const worker = new Worker(
  'workflow-jobs',
  async (bullJob) => {
    const { jobId } = bullJob.data;

    const jobDoc = await Job.findById(jobId);
    if (!jobDoc) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const workflowDoc = await Workflow.findById(jobDoc.workflow);
    if (!workflowDoc) {
      throw new Error(`Workflow not found for job: ${jobId}`);
    }

    // Set job to running on start and retries; do not reset attempts
    jobDoc.startedAt = jobDoc.startedAt || new Date();
    jobDoc.attempts = (jobDoc.attempts || 0) + 1;
    await transitionJob(jobDoc, 'running');

    logger.info(
      { jobId: jobDoc._id, attempt: jobDoc.attempts, maxAttempts: jobDoc.maxAttempts },
      `Job ${jobDoc._id} starting execution (Attempt ${jobDoc.attempts} of ${jobDoc.maxAttempts})`
    );

    let output;
    try {
      output = await runWorkflowSteps(workflowDoc, jobDoc);
    } catch (err) {
      logger.warn(
        { jobId: jobDoc._id, attempt: jobDoc.attempts, err: err.message },
        `Job ${jobDoc._id} error on attempt ${jobDoc.attempts}: ${err.message}`
      );

      const retryable = isRetryable(err);

      // Check if retries remain and error is retryable
      if (retryable && jobDoc.attempts < jobDoc.maxAttempts) {
        jobDoc.lastError = err.message;
        await transitionJob(jobDoc, 'retrying', {
          meta: { attempt: jobDoc.attempts },
        });

        // Rethrow so BullMQ schedules next attempt according to retryPolicy backoff
        throw err;
      } else {
        const reason = !retryable ? 'non_retryable' : 'max_attempts';
        jobDoc.lastError = err.message;
        jobDoc.finishedAt = new Date();
        await transitionJob(jobDoc, 'dead_lettered', {
          meta: { reason },
        });

        logger.error(
          { jobId: jobDoc._id, attempts: jobDoc.attempts, reason, err: err.message },
          `Job ${jobDoc._id} dead-lettered (${reason}) after ${jobDoc.attempts} failed attempts: ${err.message}`
        );

        // Do not rethrow so BullMQ stops and does not perform additional retries
        return;
      }
    }

    // On success: transition to succeeded safely
    try {
      jobDoc.output = output;
      jobDoc.finishedAt = new Date();
      await transitionJob(jobDoc, 'succeeded');
      return output;
    } catch (transitionErr) {
      logger.error(
        { jobId: jobDoc._id, err: transitionErr.message },
        `Error transitioning job ${jobDoc._id} to succeeded: ${transitionErr.message}`
      );
      throw transitionErr;
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

worker.on('ready', () => {
  logger.info('Worker listening on queue workflow-jobs');
});

worker.on('failed', (job, err) => {
  logger.warn(
    { bullJobId: job ? job.id : 'unknown', err: err.message },
    `BullMQ job ${job ? job.id : 'unknown'} failed attempt: ${err.message}`
  );
});

worker.on('completed', (job) => {
  logger.info({ bullJobId: job ? job.id : 'unknown' }, `BullMQ job ${job ? job.id : 'unknown'} completed`);
});

// Graceful shutdown handling
const shutdown = async (signal) => {
  logger.info(`Received ${signal}. Gracefully stopping worker...`);
  try {
    stopSlaScheduler();
    await worker.close();
    await mongoose.connection.close();
    logger.info('Worker closed and MongoDB disconnected.');
    process.exit(0);
  } catch (err) {
    logger.error({ err: err.message }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = {
  worker,
  isRetryable,
};
