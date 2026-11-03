const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/TaskWatch';

// Connect to MongoDB to manage roles and verify AuditEvent records directly
const { User, AuditEvent } = require('../src/models');

async function run() {
  console.log(`Connecting to database at ${MONGO_URI}...`);
  await mongoose.connect(MONGO_URI);

  const timestamp = Date.now();
  const password = 'Password123!';

  const adminEmail = `admin-${timestamp}@taskwatch.io`;
  const operatorEmail = `operator-${timestamp}@taskwatch.io`;
  const viewerEmail = `viewer-${timestamp}@taskwatch.io`;

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

  // 1. Register admin user & ensure admin role in DB
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin Test', email: adminEmail, password }),
  });
  await User.updateOne({ email: adminEmail }, { role: 'admin' });
  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.token;

  // 2. Register operator user & update role to "operator" directly in DB
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Operator Test', email: operatorEmail, password }),
  });
  await User.updateOne({ email: operatorEmail }, { role: 'operator' });
  const operatorLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: operatorEmail, password }),
  });
  const operatorData = await operatorLoginRes.json();
  const operatorToken = operatorData.token;

  // 3. Register viewer user (gets viewer role automatically)
  const viewerRegRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Viewer Test', email: viewerEmail, password }),
  });
  const viewerData = await viewerRegRes.json();
  const viewerToken = viewerData.token;

  console.log('Test users registered and authenticated successfully.\n');
  console.log('--- Running Workflow and Task Tests ---\n');

  let testWorkflowId = null;
  let activeWorkflowId = null;
  let testTaskId = null;

  // a. Viewer GET /api/workflows returns 200
  await check(
    'a. Viewer GET /api/workflows',
    () =>
      fetch(`${BASE_URL}/api/workflows`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      }),
    (status, body) => status === 200 && Array.isArray(body.items) && typeof body.total === 'number'
  );

  // b. Viewer POST /api/workflows returns 403
  await check(
    'b. Viewer POST /api/workflows',
    () =>
      fetch(`${BASE_URL}/api/workflows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${viewerToken}`,
        },
        body: JSON.stringify({
          name: 'Viewer WF',
          steps: [{ name: 'Step 1', order: 1 }],
        }),
      }),
    (status) => status === 403
  );

  // c. Operator POST /api/workflows with valid data returns 201
  const createResult = await check(
    'c. Operator POST /api/workflows (valid data)',
    () =>
      fetch(`${BASE_URL}/api/workflows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          name: `Workflow ${timestamp}`,
          description: 'A sample automated pipeline',
          steps: [
            { name: 'Step 1', order: 1, config: { timeout: 30 } },
            { name: 'Step 2', order: 2, config: {} },
          ],
        }),
      }),
    (status, body) => status === 201 && body._id && body.name === `Workflow ${timestamp}`
  );
  if (createResult.pass && createResult.body) {
    testWorkflowId = createResult.body._id;
  }

  // d. POST with an empty steps array returns 400
  await check(
    'd. POST /api/workflows (empty steps)',
    () =>
      fetch(`${BASE_URL}/api/workflows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          name: 'Invalid WF',
          steps: [],
        }),
      }),
    (status) => status === 400
  );

  // e. POST with duplicate step order values returns 400
  await check(
    'e. POST /api/workflows (duplicate step order)',
    () =>
      fetch(`${BASE_URL}/api/workflows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          name: 'Duplicate Steps WF',
          steps: [
            { name: 'Step 1', order: 1 },
            { name: 'Step 2', order: 1 },
          ],
        }),
      }),
    (status) => status === 400
  );

  // f. GET /api/workflows/:id with an invalid id returns 400
  await check(
    'f. GET /api/workflows/:id (invalid id)',
    () =>
      fetch(`${BASE_URL}/api/workflows/not-a-valid-id`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      }),
    (status) => status === 400
  );

  // g. GET /api/workflows/:id with a valid but unknown id returns 404
  await check(
    'g. GET /api/workflows/:id (unknown id)',
    () =>
      fetch(`${BASE_URL}/api/workflows/672740a8f9c1d2e3f4a5b6c7`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      }),
    (status) => status === 404
  );

  // h. Operator PATCH /api/workflows/:id returns 200 and updates the name
  const updatedName = `Updated Workflow ${timestamp}`;
  await check(
    'h. Operator PATCH /api/workflows/:id',
    () =>
      fetch(`${BASE_URL}/api/workflows/${testWorkflowId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({ name: updatedName }),
      }),
    (status, body) => status === 200 && body.name === updatedName
  );

  // i. Operator DELETE /api/workflows/:id returns 403 (admin only)
  await check(
    'i. Operator DELETE /api/workflows/:id (forbidden)',
    () =>
      fetch(`${BASE_URL}/api/workflows/${testWorkflowId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${operatorToken}` },
      }),
    (status) => status === 403
  );

  // j. Admin DELETE /api/workflows/:id returns 200 and isActive is false
  await check(
    'j. Admin DELETE /api/workflows/:id (soft delete)',
    () =>
      fetch(`${BASE_URL}/api/workflows/${testWorkflowId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
    (status, body) => status === 200 && body.isActive === false
  );

  // Create another active workflow to test tasks
  const activeWfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${operatorToken}`,
    },
    body: JSON.stringify({
      name: `Active Workflow ${timestamp}`,
      steps: [{ name: 'Step Alpha', order: 1 }],
    }),
  });
  const activeWfData = await activeWfRes.json();
  activeWorkflowId = activeWfData._id;

  // k. Operator POST /api/tasks for an active workflow returns 201
  const taskCreateRes = await check(
    'k. Operator POST /api/tasks (active workflow)',
    () =>
      fetch(`${BASE_URL}/api/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          workflow: activeWorkflowId,
          title: `Task for active WF ${timestamp}`,
        }),
      }),
    (status, body) => status === 201 && body._id && body.workflow === activeWorkflowId
  );
  if (taskCreateRes.pass && taskCreateRes.body) {
    testTaskId = taskCreateRes.body._id;
  }

  // l. POST /api/tasks for a deleted (inactive) workflow returns 400
  await check(
    'l. POST /api/tasks (inactive workflow)',
    () =>
      fetch(`${BASE_URL}/api/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          workflow: testWorkflowId,
          title: 'Should fail for inactive workflow',
        }),
      }),
    (status) => status === 400
  );

  // m. Viewer GET /api/tasks?workflow=<id> returns 200 with the task
  await check(
    'm. Viewer GET /api/tasks?workflow=<id>',
    () =>
      fetch(`${BASE_URL}/api/tasks?workflow=${activeWorkflowId}`, {
        headers: { Authorization: `Bearer ${viewerToken}` },
      }),
    (status, body) =>
      status === 200 &&
      Array.isArray(body.items) &&
      body.items.some((t) => t._id === testTaskId && t.workflow && t.workflow.name)
  );

  // n. Admin DELETE /api/tasks/:id returns 200
  await check(
    'n. Admin DELETE /api/tasks/:id (hard delete)',
    () =>
      fetch(`${BASE_URL}/api/tasks/${testTaskId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
    (status, body) => status === 200 && body.message === 'Task deleted'
  );

  // o. Check AuditEvent records exist for workflow.created, workflow.updated, workflow.deleted, task.created, and task.deleted
  console.log('\n--- Verifying AuditEvent Records ---');
  const requiredActions = [
    'workflow.created',
    'workflow.updated',
    'workflow.deleted',
    'task.created',
    'task.deleted',
  ];

  const auditEvents = await AuditEvent.find({
    action: { $in: requiredActions },
  });

  const foundActions = new Set(auditEvents.map((e) => e.action));
  const missingActions = requiredActions.filter((a) => !foundActions.has(a));

  if (missingActions.length === 0) {
    console.log(`[PASS] o. AuditEvent records verified for: ${requiredActions.join(', ')}`);
  } else {
    console.log(`[FAIL] o. Missing AuditEvent records for: ${missingActions.join(', ')}`);
    passedAll = false;
  }

  await mongoose.disconnect();

  console.log('\n----------------------------------------');
  if (passedAll) {
    console.log('ALL WORKFLOW & TASK TESTS PASSED!');
    process.exit(0);
  } else {
    console.error('SOME TESTS FAILED!');
    process.exit(1);
  }
}

run().catch(async (err) => {
  console.error('Fatal error during test run:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

