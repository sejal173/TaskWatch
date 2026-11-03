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

  const adminEmail = `admin-retries-${timestamp}@taskwatch.io`;
  const operatorEmail = `operator-retries-${timestamp}@taskwatch.io`;
  const viewerEmail = `viewer-retries-${timestamp}@taskwatch.io`;

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

  // 1. Admin user
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin Retries', email: adminEmail, password }),
  });
  await User.updateOne({ email: adminEmail }, { role: 'admin' });
  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.token;

  // 2. Operator user
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Operator Retries', email: operatorEmail, password }),
  });
  await User.updateOne({ email: operatorEmail }, { role: 'operator' });
  const operatorLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: operatorEmail, password }),
  });
  const operatorData = await operatorLoginRes.json();
  const operatorToken = operatorData.token;

  // 3. Viewer user
  const viewerRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Viewer Retries', email: viewerEmail, password }),
  });
  const viewerData = await viewerRegRes.json();
  const viewerToken = viewerData.token;

  console.log('Test users registered and authenticated.\n');

  // Create a failing workflow: retryPolicy { maxAttempts: 3, backoff: "fixed", delayMs: 1000 }
  const failWfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      name: `Failing Retry Workflow ${timestamp}`,
      steps: [{ name: 'Always Fail Step', order: 1, config: { simulateFailure: true } }],
      retryPolicy: { maxAttempts: 3, backoff: 'fixed', delayMs: 1000 },
    }),
  });
  const failWfData = await failWfRes.json();
  const failWorkflowId = failWfData._id;

  // Create a normal workflow for success tests
  const normalWfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      name: `Normal Workflow ${timestamp}`,
      steps: [{ name: 'Step 1 Normal', order: 1, config: {} }],
      retryPolicy: { maxAttempts: 3, backoff: 'fixed', delayMs: 1000 },
    }),
  });
  const normalWfData = await normalWfRes.json();
  const normalWorkflowId = normalWfData._id;

  console.log('--- Running Retry & Dead-Letter Queue Tests ---\n');

  // a. Create a job for the failing workflow. Poll until status is "dead_lettered" (up to 30 seconds). Pass when attempts equals 3.
  const createJobRes = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      workflow: failWorkflowId,
    }),
  });
  const jobA = await createJobRes.json();
  const jobAId = jobA._id;

  console.log(`Created failing job ${jobAId}. Polling for status 'dead_lettered' (up to 30s)...`);
  let jobAPolled = null;
  const pollStart = Date.now();

  while (Date.now() - pollStart < 30000) {
    const res = await fetch(`${BASE_URL}/api/jobs/${jobAId}`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    jobAPolled = await res.json();
    if (jobAPolled.status === 'dead_lettered' && jobAPolled.attempts === 3) {
      break;
    }
    await sleep(500);
  }

  if (jobAPolled && jobAPolled.status === 'dead_lettered' && jobAPolled.attempts === 3) {
    console.log(`[PASS] a. Job reached dead_lettered status with attempts = 3 (lastError: "${jobAPolled.lastError}")`);
  } else {
    console.log(`[FAIL] a. Job did not reach dead_lettered with attempts = 3: status=${jobAPolled?.status}, attempts=${jobAPolled?.attempts}`);
    passedAll = false;
  }

  // b. The job's AuditEvent records include exactly 2 "job.retrying" events and 1 "job.dead_lettered" event
  const jobAAudits = await AuditEvent.find({
    entityId: new mongoose.Types.ObjectId(jobAId),
  });

  const retryingEvents = jobAAudits.filter((e) => e.action === 'job.retrying');
  const deadLetteredEvents = jobAAudits.filter((e) => e.action === 'job.dead_lettered');

  if (retryingEvents.length === 2 && deadLetteredEvents.length === 1) {
    console.log(`[PASS] b. AuditEvents verified: exactly 2 job.retrying and 1 job.dead_lettered events recorded.`);
  } else {
    console.log(
      `[FAIL] b. AuditEvents mismatch: expected 2 job.retrying (got ${retryingEvents.length}) and 1 job.dead_lettered (got ${deadLetteredEvents.length})`
    );
    passedAll = false;
  }

  // c. GET /api/jobs?status=dead_lettered includes the job from test a
  await check(
    'c. GET /api/jobs?status=dead_lettered',
    () =>
      fetch(`${BASE_URL}/api/jobs?status=dead_lettered`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      }),
    (status, body) =>
      status === 200 &&
      Array.isArray(body.items) &&
      body.items.some((j) => j._id === jobAId && j.status === 'dead_lettered')
  );

  // d. POST /api/jobs/:id/replay on the dead-lettered job returns 200 with status "pending" and attempts 0.
  // Then the job ends up dead_lettered again, with attempts 3.
  const replayResult = await check(
    'd. POST /api/jobs/:id/replay',
    () =>
      fetch(`${BASE_URL}/api/jobs/${jobAId}/replay`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${operatorToken}` },
      }),
    (status, body) => status === 200 && body.status === 'pending' && body.attempts === 0
  );

  if (replayResult.pass) {
    console.log(`Replay initiated. Polling for job ${jobAId} to reach dead_lettered again...`);
    let replayedJobPolled = null;
    const replayPollStart = Date.now();

    while (Date.now() - replayPollStart < 30000) {
      const res = await fetch(`${BASE_URL}/api/jobs/${jobAId}`, {
        headers: { Authorization: `Bearer ${operatorToken}` },
      });
      replayedJobPolled = await res.json();
      if (replayedJobPolled.status === 'dead_lettered' && replayedJobPolled.attempts === 3) {
        break;
      }
      await sleep(500);
    }

    if (
      replayedJobPolled &&
      replayedJobPolled.status === 'dead_lettered' &&
      replayedJobPolled.attempts === 3
    ) {
      console.log(`[PASS] d. Replayed job reached dead_lettered again with attempts = 3`);
    } else {
      console.log(
        `[FAIL] d. Replayed job failed to reach dead_lettered: status=${replayedJobPolled?.status}, attempts=${replayedJobPolled?.attempts}`
      );
      passedAll = false;
    }
  }

  // Create a normal job that will succeed for tests e and h
  const normalJobRes = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      workflow: normalWorkflowId,
    }),
  });
  const normalJobData = await normalJobRes.json();
  const normalJobId = normalJobData._id;

  // Wait for normal job to reach succeeded
  console.log(`Waiting for normal job ${normalJobId} to succeed...`);
  let normalPolled = null;
  const normalStart = Date.now();
  while (Date.now() - normalStart < 15000) {
    const r = await fetch(`${BASE_URL}/api/jobs/${normalJobId}`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    normalPolled = await r.json();
    if (normalPolled.status === 'succeeded') break;
    await sleep(500);
  }

  // e. POST /api/jobs/:id/replay on a succeeded job returns 400
  await check(
    'e. POST /api/jobs/:id/replay on succeeded job (expect 400)',
    () =>
      fetch(`${BASE_URL}/api/jobs/${normalJobId}/replay`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${operatorToken}` },
      }),
    (status) => status === 400
  );

  // f. Viewer POST /api/jobs/:id/replay returns 403
  await check(
    'f. Viewer POST /api/jobs/:id/replay (expect 403)',
    () =>
      fetch(`${BASE_URL}/api/jobs/${jobAId}/replay`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${viewerToken}` },
      }),
    (status) => status === 403
  );

  // g. POST /api/jobs/:id/discard on a dead-lettered job returns 200 with status "discarded"
  await check(
    'g. POST /api/jobs/:id/discard on dead-lettered job',
    () =>
      fetch(`${BASE_URL}/api/jobs/${jobAId}/discard`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${operatorToken}` },
      }),
    (status, body) => status === 200 && body.status === 'discarded'
  );

  // h. POST /api/jobs/:id/discard on a succeeded job returns 400
  await check(
    'h. POST /api/jobs/:id/discard on succeeded job (expect 400)',
    () =>
      fetch(`${BASE_URL}/api/jobs/${normalJobId}/discard`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${operatorToken}` },
      }),
    (status) => status === 400
  );

  // i. A job from a normal (non-failing) workflow still reaches "succeeded" on the first attempt with attempts 1
  if (normalPolled && normalPolled.status === 'succeeded' && normalPolled.attempts === 1) {
    console.log(
      `[PASS] i. Normal job reached 'succeeded' on first attempt with attempts = 1 (output: ${JSON.stringify(normalPolled.output)})`
    );
  } else {
    console.log(
      `[FAIL] i. Normal job failed: status=${normalPolled?.status}, attempts=${normalPolled?.attempts}`
    );
    passedAll = false;
  }

  await mongoose.disconnect();

  console.log('\n----------------------------------------');
  if (passedAll) {
    console.log('ALL RETRY & DEAD-LETTER TESTS PASSED!');
    process.exit(0);
  } else {
    console.error('SOME RETRY TESTS FAILED!');
    process.exit(1);
  }
}

run().catch(async (err) => {
  console.error('Fatal error during test run:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

