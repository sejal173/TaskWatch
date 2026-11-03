require('dotenv').config();
const mongoose = require('mongoose');
const { Worker } = require('bullmq');
const connectDB = require('../config/db');
const redisConnection = require('../config/redis');
const { Job, Workflow } = require('../models');
const { runWorkflowSteps } = require('./stepRunner');
const { recordAudit } = require('../services/audit');
const { startSlaScheduler, stopSlaScheduler } = require('../services/slaChecker');

// Connect to MongoDB
connectDB();

// Start SLA breach monitoring scheduler
startSlaScheduler();

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
    jobDoc.status = 'running';
    jobDoc.startedAt = jobDoc.startedAt || new Date();
    jobDoc.attempts = (jobDoc.attempts || 0) + 1;
    await jobDoc.save();

    console.log(
      `Job ${jobDoc._id} starting execution (Attempt ${jobDoc.attempts} of ${jobDoc.maxAttempts})`
    );

    try {
      const output = await runWorkflowSteps(workflowDoc, jobDoc);

      // On success
      jobDoc.status = 'succeeded';
      jobDoc.output = output;
      jobDoc.finishedAt = new Date();
      await jobDoc.save();

      await recordAudit({
        action: 'job.succeeded',
        entityType: 'job',
        entityId: jobDoc._id,
        actor: null,
        before: null,
        after: jobDoc.toObject(),
      });

      return output;
    } catch (err) {
      console.warn(`Job ${jobDoc._id} error on attempt ${jobDoc.attempts}: ${err.message}`);

      // Check if retries remain
      if (jobDoc.attempts < jobDoc.maxAttempts) {
        jobDoc.status = 'retrying';
        jobDoc.lastError = err.message;
        await jobDoc.save();

        const afterPayload = jobDoc.toObject();
        afterPayload.attempt = jobDoc.attempts;

        await recordAudit({
          action: 'job.retrying',
          entityType: 'job',
          entityId: jobDoc._id,
          actor: null,
          before: null,
          after: afterPayload,
        });

        // Rethrow so BullMQ schedules next attempt according to retryPolicy backoff
        throw err;
      } else {
        // No retries left: dead letter the job
        jobDoc.status = 'dead_lettered';
        jobDoc.lastError = err.message;
        jobDoc.finishedAt = new Date();
        await jobDoc.save();

        await recordAudit({
          action: 'job.dead_lettered',
          entityType: 'job',
          entityId: jobDoc._id,
          actor: null,
          before: null,
          after: jobDoc.toObject(),
        });

        console.error(
          `Job ${jobDoc._id} dead-lettered after ${jobDoc.attempts} failed attempts: ${err.message}`
        );

        // Do not rethrow so BullMQ stops and does not perform additional retries
        return;
      }
    }
  },
  {
    connection: redisConnection,
    concurrency: 2,
  }
);

worker.on('ready', () => {
  console.log('Worker listening on queue workflow-jobs');
});

worker.on('failed', (job, err) => {
  console.warn(`BullMQ job ${job ? job.id : 'unknown'} failed attempt:`, err.message);
});

worker.on('completed', (job) => {
  console.log(`BullMQ job ${job ? job.id : 'unknown'} completed`);
});

// Graceful shutdown handling
const shutdown = async (signal) => {
  console.log(`\nReceived ${signal}. Gracefully stopping worker...`);
  try {
    stopSlaScheduler();
    await worker.close();
    await mongoose.connection.close();
    console.log('Worker closed and MongoDB disconnected.');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = worker;
