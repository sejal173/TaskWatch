const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/TaskWatch';

const { User, AuditEvent } = require('../src/models');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  console.log(`Connecting to MongoDB at ${MONGO_URI}...`);
  await mongoose.connect(MONGO_URI);

  const timestamp = Date.now();
  const password = 'Password123!';

  const adminEmail = `admin-jobs-${timestamp}@taskwatch.io`;
  const operatorEmail = `operator-jobs-${timestamp}@taskwatch.io`;
  const viewerEmail = `viewer-jobs-${timestamp}@taskwatch.io`;

  let passedAll = true;

  async function check(name, requestFn, validateFn) {
    try {
      const res = await requestFn();
      let body;
      const text = await res.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }

      const pass = validateFn(res.status, body);
      const label = pass ? 'PASS' : 'FAIL';
      if (!pass) passedAll = false;

      const bodyStr = typeof body === 'object' ? JSON.stringify(body) : body;
      console.log(`[${label}] ${name} -> Status: ${res.status}, Body: ${bodyStr}`);
      return { pass, status: res.status, body };
    } catch (err) {
      console.log(`[FAIL] ${name} -> Error: ${err.message}`);
      passedAll = false;
      return { pass: false, error: err };
    }
  }

  console.log('\n--- Setting up Test Users ---');

  // 1. Register and setup Admin
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin Jobs', email: adminEmail, password }),
  });
  await User.updateOne({ email: adminEmail }, { role: 'admin' });
  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.token;

  // 2. Register and setup Operator
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Operator Jobs', email: operatorEmail, password }),
  });
  await User.updateOne({ email: operatorEmail }, { role: 'operator' });
  const operatorLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: operatorEmail, password }),
  });
  const operatorData = await operatorLoginRes.json();
  const operatorToken = operatorData.token;

  // 3. Register Viewer
  const viewerRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Viewer Jobs', email: viewerEmail, password }),
  });
  const viewerData = await viewerRegRes.json();
  const viewerToken = viewerData.token;

  console.log('Test users registered and authenticated.\n');

  // Create one active workflow with two normal steps
  const wfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      name: `Normal Pipeline ${timestamp}`,
      description: 'Pipeline for job processing',
      steps: [
        { name: 'Prepare Environment', order: 1, config: {} },
        { name: 'Process Data', order: 2, config: {} },
      ],
      retryPolicy: { maxAttempts: 3 },
    }),
  });
  const activeWf = await wfRes.json();
  const activeWorkflowId = activeWf._id;

  console.log(`Active workflow created: ${activeWorkflowId}\n`);
  console.log('--- Running Job API & Worker Tests ---\n');

  let jobAId = null;

  // a. POST /api/jobs with a valid workflow returns 201 and status "pending", and queueJobId set after short wait
  const jobAResult = await check(
    'a. POST /api/jobs (valid workflow)',
    () =>
      fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          workflow: activeWorkflowId,
          input: { sampleData: 'test-input' },
        }),
      }),
    (status, body) => status === 201 && body._id && body.status === 'pending'
  );

  if (jobAResult.pass && jobAResult.body) {
    jobAId = jobAResult.body._id;
  }

  // Short wait and verify queueJobId
  await sleep(300);
  const getJobARes = await fetch(`${BASE_URL}/api/jobs/${jobAId}`, {
    headers: { Authorization: `Bearer ${operatorToken}` },
  });
  const getJobAData = await getJobARes.json();
  if (getJobAData.queueJobId) {
    console.log(`[PASS] a. Verified queueJobId is set on Job: ${getJobAData.queueJobId}`);
  } else {
    console.log(`[FAIL] a. queueJobId was not set on Job`);
    passedAll = false;
  }

  // b. POST /api/jobs for an inactive workflow returns 400
  // Create and soft-delete an inactive workflow
  const inactiveWfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      name: `Inactive Pipeline ${timestamp}`,
      steps: [{ name: 'Step 1', order: 1 }],
    }),
  });
  const inactiveWfData = await inactiveWfRes.json();
  await fetch(`${BASE_URL}/api/workflows/${inactiveWfData._id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  await check(
    'b. POST /api/jobs (inactive workflow)',
    () =>
      fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          workflow: inactiveWfData._id,
        }),
      }),
    (status) => status === 400
  );

  // c. POST /api/jobs with a task that belongs to a different workflow returns 400
  // Create another workflow and a task belonging to it
  const otherWfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      name: `Other Pipeline ${timestamp}`,
      steps: [{ name: 'Step 1', order: 1 }],
    }),
  });
  const otherWfData = await otherWfRes.json();

  const otherTaskRes = await fetch(`${BASE_URL}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      workflow: otherWfData._id,
      title: 'Task in other workflow',
    }),
  });
  const otherTaskData = await otherTaskRes.json();

  await check(
    'c. POST /api/jobs (task belongs to different workflow)',
    () =>
      fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          workflow: activeWorkflowId,
          task: otherTaskData._id,
        }),
      }),
    (status) => status === 400
  );

  // d. Viewer POST /api/jobs returns 403
  await check(
    'd. Viewer POST /api/jobs (forbidden)',
    () =>
      fetch(`${BASE_URL}/api/jobs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerToken}`,
        },
        body: JSON.stringify({
          workflow: activeWorkflowId,
        }),
      }),
    (status) => status === 403
  );

  // e. GET /api/jobs/:id with an invalid id returns 400
  await check(
    'e. GET /api/jobs/:id (invalid id)',
    () =>
      fetch(`${BASE_URL}/api/jobs/invalid-object-id`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      }),
    (status) => status === 400
  );

  // f. Poll GET /api/jobs/:id for up to 15 seconds. Pass when status becomes "succeeded"
  console.log('Polling job from test a for completion (up to 15s)...');
  let jobFStatus = 'pending';
  let jobFData = null;
  const pollStart = Date.now();

  while (Date.now() - pollStart < 15000) {
    const pollRes = await fetch(`${BASE_URL}/api/jobs/${jobAId}`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    jobFData = await pollRes.json();
    jobFStatus = jobFData.status;

    if (jobFStatus === 'succeeded') {
      break;
    }
    await sleep(500);
  }

  if (jobFStatus === 'succeeded') {
    console.log(`[PASS] f. Poll GET /api/jobs/:id -> Status: 200, Job status: succeeded (output: ${JSON.stringify(jobFData.output)})`);
  } else {
    console.log(`[FAIL] f. Poll GET /api/jobs/:id -> Job status is '${jobFStatus}'. (Make sure 'npm run worker' is running!)`);
    passedAll = false;
  }

  // g. Create a workflow where one step has config { simulateFailure: true }. Create a job for it. Poll until status is "failed"
  const failWfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      name: `Failing Pipeline ${timestamp}`,
      steps: [
        { name: 'Initial Step', order: 1, config: {} },
        { name: 'Buggy Step', order: 2, config: { simulateFailure: true } },
      ],
      retryPolicy: { maxAttempts: 1, backoff: 'fixed', delayMs: 100 },
    }),
  });
  const failWfData = await failWfRes.json();

  const failJobRes = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      workflow: failWfData._id,
    }),
  });
  const failJobData = await failJobRes.json();
  const failJobId = failJobData._id;

  console.log(`Failing workflow job created: ${failJobId}. Polling for failure...`);
  let failJobStatus = 'pending';
  let failJobPolled = null;
  const failPollStart = Date.now();

  while (Date.now() - failPollStart < 15000) {
    const pRes = await fetch(`${BASE_URL}/api/jobs/${failJobId}`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    failJobPolled = await pRes.json();
    failJobStatus = failJobPolled.status;

    if (failJobStatus === 'failed' || failJobStatus === 'dead_lettered') {
      break;
    }
    await sleep(500);
  }

  const hasSimulatedError =
    failJobPolled &&
    typeof failJobPolled.lastError === 'string' &&
    failJobPolled.lastError.includes('Simulated failure');
  const attemptsIsOne = failJobPolled && failJobPolled.attempts === 1;

  if (
    (failJobStatus === 'failed' || failJobStatus === 'dead_lettered') &&
    hasSimulatedError &&
    attemptsIsOne
  ) {
    console.log(`[PASS] g. Failing job verified -> Status: failed, lastError: "${failJobPolled.lastError}", attempts: ${failJobPolled.attempts}`);
  } else {
    console.log(`[FAIL] g. Failing job check failed -> Status: ${failJobStatus}, lastError: "${failJobPolled ? failJobPolled.lastError : ''}", attempts: ${failJobPolled ? failJobPolled.attempts : ''}`);
    passedAll = false;
  }

  // h. GET /api/jobs?status=succeeded returns 200 and includes the job from test f
  await check(
    'h. GET /api/jobs?status=succeeded',
    () =>
      fetch(`${BASE_URL}/api/jobs?status=succeeded`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      }),
    (status, body) =>
      status === 200 &&
      Array.isArray(body.items) &&
      body.items.some((j) => j._id === jobAId)
  );

  // i. AuditEvent records exist for job.created, job.succeeded, and job.failed
  console.log('\n--- Verifying AuditEvent Records for Jobs ---');
  const requiredJobEvents = ['job.created', 'job.succeeded', 'job.failed'];
  const auditRecords = await AuditEvent.find({
    action: { $in: requiredJobEvents },
  });

  const recordedActions = new Set(auditRecords.map((e) => e.action));
  const missingEvents = requiredJobEvents.filter((a) => !recordedActions.has(a));

  if (missingEvents.length === 0) {
    console.log(`[PASS] i. AuditEvent records verified for: ${requiredJobEvents.join(', ')}`);
  } else {
    console.log(`[FAIL] i. Missing AuditEvent records for: ${missingEvents.join(', ')}`);
    passedAll = false;
  }

  await mongoose.disconnect();

  console.log('\n----------------------------------------');
  if (passedAll) {
    console.log('ALL JOB QUEUE & WORKER TESTS PASSED!');
    process.exit(0);
  } else {
    console.error('SOME JOB TESTS FAILED!');
    process.exit(1);
  }
}

run().catch(async (err) => {
  console.error('Fatal error in test script:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

