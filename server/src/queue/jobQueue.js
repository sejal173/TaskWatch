const { Queue } = require('bullmq');
const redisConnection = require('../config/redis');

// BullMQ Queue instance for workflow jobs
const jobQueue = new Queue('workflow-jobs', {
  connection: redisConnection,
});

/**
 * Enqueue a MongoDB Job document into BullMQ workflow-jobs queue.
 * Configures attempts and backoff based on the job's maxAttempts and workflow's retryPolicy.
 *
 * @param {import('../models').Job} jobDoc - MongoDB Job document
 * @param {Object} [retryPolicy] - Optional workflow retryPolicy { maxAttempts, backoff, delayMs }
 * @param {string} [customJobId] - Optional custom BullMQ job id (e.g., for replayed jobs)
 */
const enqueueJob = async (jobDoc, retryPolicy = null, customJobId = null) => {
  const attempts =
    jobDoc.maxAttempts ||
    (retryPolicy && typeof retryPolicy.maxAttempts === 'number' ? retryPolicy.maxAttempts : 3);

  const backoffType =
    retryPolicy && (retryPolicy.backoff === 'fixed' || retryPolicy.backoff === 'exponential')
      ? retryPolicy.backoff
      : 'exponential';

  const delayMs =
    retryPolicy && typeof retryPolicy.delayMs === 'number' && retryPolicy.delayMs >= 0
      ? retryPolicy.delayMs
      : 5000;

  const bullJobId = customJobId ? String(customJobId) : String(jobDoc._id);

  // Commit document changes (such as attempts = 0 or status = pending) before enqueuing to prevent race condition
  await jobDoc.save();

  const bullJob = await jobQueue.add(
    'execute-job',
    { jobId: String(jobDoc._id) },
    {
      jobId: bullJobId,
      attempts,
      backoff: {
        type: backoffType,
        delay: delayMs,
      },
      removeOnComplete: 100,
      removeOnFail: 500,
    }
  );

  jobDoc.queueJobId = String(bullJob.id);
  await jobDoc.save();

  return bullJob;
};

module.exports = {
  jobQueue,
  enqueueJob,
};
