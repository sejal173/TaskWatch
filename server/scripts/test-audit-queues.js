const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/TaskWatch';

const { User, AuditEvent, Workflow } = require('../src/models');

async function run() {
  console.log(`Connecting to MongoDB at ${MONGO_URI}...`);
  await mongoose.connect(MONGO_URI);

  const timestamp = Date.now();
  const password = 'Password123!';

  const adminEmail = `admin-audit-${timestamp}@taskwatch.io`;
  const operatorEmail = `operator-audit-${timestamp}@taskwatch.io`;
  const viewerEmail = `viewer-audit-${timestamp}@taskwatch.io`;

  let passedAll = true;

  function report(name, pass, detail) {
    const label = pass ? 'PASS' : 'FAIL';
    if (!pass) passedAll = false;
    console.log(`[${label}] ${name} -> ${detail}`);
    return pass;
  }

  console.log('\n--- Setting up Test Users & Baseline Data ---');

  // Register Admin
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin Audit', email: adminEmail, password }),
  });
  await User.updateOne({ email: adminEmail }, { role: 'admin' });
  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.token;

  // Register Operator
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Operator Audit', email: operatorEmail, password }),
  });
  await User.updateOne({ email: operatorEmail }, { role: 'operator' });
  const operatorLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: operatorEmail, password }),
  });
  const operatorData = await operatorLoginRes.json();
  const operatorToken = operatorData.token;

  // Register Viewer
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Viewer Audit', email: viewerEmail, password }),
  });
  const viewerLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: viewerEmail, password }),
  });
  const viewerData = await viewerLoginRes.json();
  const viewerToken = viewerData.token;

  // Ensure at least one workflow audit event exists for test d
  await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: `Audit Test Workflow ${timestamp}`,
      steps: [{ name: 'Step 1', order: 1 }],
    }),
  });

  console.log('\n--- Running Step 12: Audit Trail & Queue Tests ---');

  // a. Admin GET /api/audit returns 200 with items and total.
  try {
    const res = await fetch(`${BASE_URL}/api/audit`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    const pass = res.status === 200 && Array.isArray(body.items) && typeof body.total === 'number';
    report(
      'a. Admin GET /api/audit returns 200 with items and total',
      pass,
      `Status: ${res.status}, items: ${body.items ? body.items.length : 0}, total: ${body.total}`
    );
  } catch (err) {
    report('a. Admin GET /api/audit returns 200 with items and total', false, err.message);
  }

  // b. Operator GET /api/audit returns 403.
  try {
    const res = await fetch(`${BASE_URL}/api/audit`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    const body = await res.json();
    const pass = res.status === 403;
    report('b. Operator GET /api/audit returns 403', pass, `Status: ${res.status}, Body: ${JSON.stringify(body)}`);
  } catch (err) {
    report('b. Operator GET /api/audit returns 403', false, err.message);
  }

  // c. Viewer GET /api/audit returns 403.
  try {
    const res = await fetch(`${BASE_URL}/api/audit`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    const body = await res.json();
    const pass = res.status === 403;
    report('c. Viewer GET /api/audit returns 403', pass, `Status: ${res.status}, Body: ${JSON.stringify(body)}`);
  } catch (err) {
    report('c. Viewer GET /api/audit returns 403', false, err.message);
  }

  // d. GET /api/audit?entityType=workflow returns only items where entityType is "workflow".
  try {
    const res = await fetch(`${BASE_URL}/api/audit?entityType=workflow`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    const allWorkflow =
      res.status === 200 &&
      Array.isArray(body.items) &&
      body.items.length > 0 &&
      body.items.every((item) => item.entityType === 'workflow');
    report(
      'd. GET /api/audit?entityType=workflow returns only workflow items',
      allWorkflow,
      `Status: ${res.status}, items count: ${body.items ? body.items.length : 0}`
    );
  } catch (err) {
    report('d. GET /api/audit?entityType=workflow returns only workflow items', false, err.message);
  }

  // e. GET /api/audit?entityType=bogus returns 400.
  try {
    const res = await fetch(`${BASE_URL}/api/audit?entityType=bogus`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    const pass = res.status === 400 && body.error;
    report('e. GET /api/audit?entityType=bogus returns 400', pass, `Status: ${res.status}, Body: ${JSON.stringify(body)}`);
  } catch (err) {
    report('e. GET /api/audit?entityType=bogus returns 400', false, err.message);
  }

  // f. GET /api/audit response items contain no passwordHash anywhere.
  try {
    const res = await fetch(`${BASE_URL}/api/audit?limit=100`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const text = await res.text();
    const hasPasswordHash = text.includes('passwordHash');
    const pass = res.status === 200 && !hasPasswordHash;
    report(
      'f. GET /api/audit response items contain no passwordHash anywhere',
      pass,
      `Status: ${res.status}, contains "passwordHash": ${hasPasswordHash}`
    );
  } catch (err) {
    report('f. GET /api/audit response items contain no passwordHash anywhere', false, err.message);
  }

  // g. Operator GET /api/queues/stats returns 200 with numeric counts for waiting, active, delayed, completed, and failed.
  try {
    const res = await fetch(`${BASE_URL}/api/queues/stats`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    const body = await res.json();
    const pass =
      res.status === 200 &&
      body.counts &&
      typeof body.counts.waiting === 'number' &&
      typeof body.counts.active === 'number' &&
      typeof body.counts.delayed === 'number' &&
      typeof body.counts.completed === 'number' &&
      typeof body.counts.failed === 'number';
    report(
      'g. Operator GET /api/queues/stats returns 200 with numeric counts',
      pass,
      `Status: ${res.status}, name: "${body.name}", counts: ${JSON.stringify(body.counts)}`
    );
  } catch (err) {
    report('g. Operator GET /api/queues/stats returns 200 with numeric counts', false, err.message);
  }

  // h. Viewer GET /api/queues/stats returns 403.
  try {
    const res = await fetch(`${BASE_URL}/api/queues/stats`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    const body = await res.json();
    const pass = res.status === 403;
    report('h. Viewer GET /api/queues/stats returns 403', pass, `Status: ${res.status}, Body: ${JSON.stringify(body)}`);
  } catch (err) {
    report('h. Viewer GET /api/queues/stats returns 403', false, err.message);
  }

  // i. Operator POST /api/queues/pause returns 403.
  try {
    const res = await fetch(`${BASE_URL}/api/queues/pause`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    const body = await res.json();
    const pass = res.status === 403;
    report('i. Operator POST /api/queues/pause returns 403', pass, `Status: ${res.status}, Body: ${JSON.stringify(body)}`);
  } catch (err) {
    report('i. Operator POST /api/queues/pause returns 403', false, err.message);
  }

  // j. Admin POST /api/queues/pause returns 200 with paused true, then GET /api/queues/stats shows paused true.
  try {
    const pauseRes = await fetch(`${BASE_URL}/api/queues/pause`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const pauseBody = await pauseRes.json();

    const statsRes = await fetch(`${BASE_URL}/api/queues/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const statsBody = await statsRes.json();

    const pass =
      pauseRes.status === 200 &&
      pauseBody.paused === true &&
      statsRes.status === 200 &&
      statsBody.paused === true;
    report(
      'j. Admin POST /api/queues/pause returns 200 with paused: true & verified via stats',
      pass,
      `Pause Status: ${pauseRes.status}, Paused: ${pauseBody.paused}, Stats Paused: ${statsBody.paused}`
    );
  } catch (err) {
    report('j. Admin POST /api/queues/pause returns 200 with paused: true', false, err.message);
  }

  // k. Admin POST /api/queues/resume returns 200 with paused false.
  try {
    const resumeRes = await fetch(`${BASE_URL}/api/queues/resume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const resumeBody = await resumeRes.json();

    const statsRes = await fetch(`${BASE_URL}/api/queues/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const statsBody = await statsRes.json();

    const pass =
      resumeRes.status === 200 &&
      resumeBody.paused === false &&
      statsRes.status === 200 &&
      statsBody.paused === false;
    report(
      'k. Admin POST /api/queues/resume returns 200 with paused: false & verified via stats',
      pass,
      `Resume Status: ${resumeRes.status}, Paused: ${resumeBody.paused}, Stats Paused: ${statsBody.paused}`
    );
  } catch (err) {
    report('k. Admin POST /api/queues/resume returns 200 with paused: false', false, err.message);
  }

  // l. Audit records exist for queue.paused and queue.resumed.
  try {
    const pausedAudit = await AuditEvent.findOne({ action: 'queue.paused' });
    const resumedAudit = await AuditEvent.findOne({ action: 'queue.resumed' });
    const pass = !!pausedAudit && !!resumedAudit;
    report(
      'l. Audit records exist for queue.paused and queue.resumed',
      pass,
      `queue.paused found: ${!!pausedAudit}, queue.resumed found: ${!!resumedAudit}`
    );
  } catch (err) {
    report('l. Audit records exist for queue.paused and queue.resumed', false, err.message);
  }

  await mongoose.disconnect();

  console.log(`\n========================================`);
  console.log(passedAll ? 'ALL AUDIT & QUEUE TESTS PASSED' : 'SOME AUDIT & QUEUE TESTS FAILED');
  console.log(`========================================\n`);

  process.exit(passedAll ? 0 : 1);
}

run().catch((err) => {
  console.error('Fatal error during audit and queue tests:', err);
  process.exit(1);
});

