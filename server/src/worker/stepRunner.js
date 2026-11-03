/**
 * Helper to simulate asynchronous execution delay
 * @param {number} ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute steps defined in a workflow sequentially.
 * Simulates step processing with a 500ms delay per step.
 * Throws if step.config.simulateFailure is true.
 *
 * @param {Object} workflow
 * @param {Object} job
 * @returns {Promise<{ completedSteps: number, finishedAt: Date }>}
 */
const runWorkflowSteps = async (workflow, job) => {
  const steps = [...(workflow.steps || [])].sort((a, b) => a.order - b.order);
  let completedCount = 0;

  for (const step of steps) {
    console.log(`Running step ${step.order}: ${step.name}`);
    await sleep(500);

    if (step.config && step.config.simulateFailure === true) {
      throw new Error(`Simulated failure at step ${step.name}`);
    }

    completedCount++;
  }

  return {
    completedSteps: completedCount,
    finishedAt: new Date(),
  };
};

module.exports = {
  runWorkflowSteps,
};

