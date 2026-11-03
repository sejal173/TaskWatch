const http = require('http');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/TaskWatch';

const { User, Workflow, Job, AuditEvent } = require('../src/models');
const { runSlaCheck } = require('../src/services/slaChecker');

async function run() {
  console.log(`Connecting to MongoDB at ${MONGO_URI}...`);
  await mongoose.connect(MONGO_URI);

  const timestamp = Date.now();
  const password = 'Password123!';
  const adminEmail = `admin-sla-${timestamp}@taskwatch.io`;

  let passedAll = true;

  function report(name, pass, detail) {
    const label = pass ? 'PASS' : 'FAIL';
    if (!pass) passedAll = false;
    console.log(`[${label}] ${name} -> ${detail}`);
    return pass;
  }

  console.log('\n--- Setting up Admin User ---');
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin SLA', email: adminEmail, password }),
  });
  await User.updateOne({ email: adminEmail }, { role: 'admin' });

  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const loginData = await loginRes.json();
  const token = loginData.token;

  console.log('\n--- Running Step 9 SLA Breach Tests ---');

  // Test a: Workflow with slaMinutes: 10 sets deadlineAt to ~10 minutes in future
  let jobWithSlaId = null;
  let wfWithSlaId = null;
  try {
    const wfRes = await fetch(`${BASE_URL}/api/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: `SLA Workflow 10m ${timestamp}`,
        slaMinutes: 10,
        steps: [{ name: 'step1', order: 1, config: {} }],
      }),
    });
    const wf = await wfRes.json();
    wfWithSlaId = wf._id;

    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ workflow: wf._id }),
    });
    const job = await jobRes.json();
    jobWithSlaId = job._id;

    const jobDeadline = new Date(job.deadlineAt).getTime();
    const expectedDeadline = Date.now() + 10 * 60 * 1000;
    const diffMs = Math.abs(jobDeadline - expectedDeadline);
    const pass = jobRes.status === 201 && diffMs < 15000;
    report(
      'Test a: Workflow with slaMinutes: 10 sets deadlineAt to ~10 min future',
      pass,
      `Status: ${jobRes.status}, deadlineAt: ${job.deadlineAt}, diffMs: ${diffMs}`
    );
  } catch (err) {
    report('Test a: Workflow with slaMinutes: 10 sets deadlineAt to ~10 min future', false, err.message);
  }

  // Test b: Workflow without SLA (slaMinutes: null) leaves deadlineAt: null
  try {
    const wfNoSlaRes = await fetch(`${BASE_URL}/api/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: `No SLA Workflow ${timestamp}`,
        slaMinutes: null,
        steps: [{ name: 'step1', order: 1, config: {} }],
      }),
    });
    const wfNoSla = await wfNoSlaRes.json();

    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ workflow: wfNoSla._id }),
    });
    const job = await jobRes.json();

    const pass = jobRes.status === 201 && job.deadlineAt === null;
    report(
      'Test b: Workflow without SLA (slaMinutes: null) leaves deadlineAt null',
      pass,
      `Status: ${jobRes.status}, deadlineAt: ${job.deadlineAt}`
    );
  } catch (err) {
    report('Test b: Workflow without SLA (slaMinutes: null) leaves deadlineAt null', false, err.message);
  }

  // Test c: Create test job with deadlineAt backdated to 5 min ago & status "running" -> runSlaCheck alerts & records audit
  let backdatedJobId = null;
  try {
    const backdatedJob = await Job.create({
      workflow: wfWithSlaId,
      status: 'running',
      maxAttempts: 3,
      deadlineAt: new Date(Date.now() - 5 * 60 * 1000),
      slaAlertedAt: null,
    });
    backdatedJobId = backdatedJob._id;

    const countAlerted = await runSlaCheck();

    const updatedJob = await Job.findById(backdatedJobId);
    const audit = await AuditEvent.findOne({
      action: 'job.sla_breached',
      entityId: backdatedJobId,
    });

    const pass =
      countAlerted >= 1 &&
      updatedJob.slaAlertedAt !== null &&
      audit !== null &&
      audit.action === 'job.sla_breached' &&
      audit.after &&
      audit.after.status === 'running';

    report(
      'Test c: Backdated running job triggers alert, sets slaAlertedAt, records audit event',
      pass,
      `AlertedCount: ${countAlerted}, slaAlertedAt: ${updatedJob ? updatedJob.slaAlertedAt : 'null'}, Audit found: ${!!audit}`
    );
  } catch (err) {
    report('Test c: Backdated running job triggers alert, sets slaAlertedAt, records audit event', false, err.message);
  }

  // Test d: Calling runSlaCheck() a second time does not re-alert that same job (idempotent)
  try {
    const countAlertedSecond = await runSlaCheck();
    const audits = await AuditEvent.find({
      action: 'job.sla_breached',
      entityId: backdatedJobId,
    });

    const pass = audits.length === 1;
    report(
      'Test d: Calling runSlaCheck() a second time is idempotent (no re-alert)',
      pass,
      `Audit records for job: ${audits.length}, Second run alerted: ${countAlertedSecond}`
    );
  } catch (err) {
    report('Test d: Calling runSlaCheck() a second time is idempotent (no re-alert)', false, err.message);
  }

  // Test e: A backdated job whose status is "succeeded", "dead_lettered", or "discarded" is not alerted
  try {
    const pastDate = new Date(Date.now() - 10 * 60 * 1000);
    const terminalJobs = await Job.create([
      { workflow: wfWithSlaId, status: 'succeeded', maxAttempts: 3, deadlineAt: pastDate, slaAlertedAt: null },
      { workflow: wfWithSlaId, status: 'dead_lettered', maxAttempts: 3, deadlineAt: pastDate, slaAlertedAt: null },
      { workflow: wfWithSlaId, status: 'discarded', maxAttempts: 3, deadlineAt: pastDate, slaAlertedAt: null },
    ]);

    await runSlaCheck();

    const reloadedTerminal = await Job.find({ _id: { $in: terminalJobs.map((j) => j._id) } });
    const anyAlerted = reloadedTerminal.some((j) => j.slaAlertedAt !== null);

    const pass = !anyAlerted;
    report(
      'Test e: Backdated jobs with status succeeded, dead_lettered, or discarded are not alerted',
      pass,
      `Terminal jobs checked: ${reloadedTerminal.length}, Any alerted: ${anyAlerted}`
    );
  } catch (err) {
    report('Test e: Backdated jobs with status succeeded, dead_lettered, or discarded are not alerted', false, err.message);
  }

  // Test f: GET /api/jobs?slaBreached=true returns the breached job and does not return non-breached jobs
  try {
    const res = await fetch(`${BASE_URL}/api/jobs?slaBreached=true`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const body = await res.json();

    const hasBreachedJob = body.items && body.items.some((j) => String(j._id) === String(backdatedJobId));
    const hasNonBreachedJob = body.items && body.items.some((j) => String(j._id) === String(jobWithSlaId));
    const allItemsAlerted = body.items && body.items.every((j) => j.slaAlertedAt !== null);

    const pass = res.status === 200 && hasBreachedJob && !hasNonBreachedJob && allItemsAlerted;
    report(
      'Test f: GET /api/jobs?slaBreached=true returns breached jobs and excludes non-breached jobs',
      pass,
      `Status: ${res.status}, Total items: ${body.items ? body.items.length : 0}, Has breached: ${hasBreachedJob}, Has non-breached: ${hasNonBreachedJob}`
    );
  } catch (err) {
    report('Test f: GET /api/jobs?slaBreached=true returns breached jobs and excludes non-breached jobs', false, err.message);
  }

  // Test g: With SLA_WEBHOOK_URL set to local HTTP server, runSlaCheck() delivers POST payload
  try {
    const receivedPayloads = [];
    const testServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          receivedPayloads.push(JSON.parse(body));
        } catch (e) {
          receivedPayloads.push(body);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise((resolve) => {
      testServer.listen(0, '127.0.0.1', resolve);
    });
    const port = testServer.address().port;
    const webhookUrl = `http://127.0.0.1:${port}/webhook`;
    process.env.SLA_WEBHOOK_URL = webhookUrl;

    const webhookTestJob = await Job.create({
      workflow: wfWithSlaId,
      status: 'pending',
      maxAttempts: 3,
      deadlineAt: new Date(Date.now() - 2 * 60 * 1000),
      slaAlertedAt: null,
    });

    await runSlaCheck();

    testServer.close();
    delete process.env.SLA_WEBHOOK_URL;

    const matchingPayload = receivedPayloads.find(
      (p) => p.data && String(p.data.jobId) === String(webhookTestJob._id)
    );

    const pass =
      matchingPayload &&
      matchingPayload.type === 'sla_breached' &&
      typeof matchingPayload.message === 'string' &&
      matchingPayload.message.includes(String(webhookTestJob._id)) &&
      matchingPayload.data.status === 'pending' &&
      matchingPayload.sentAt;

    report(
      'Test g: Webhook delivers POST payload with expected structure when SLA_WEBHOOK_URL is set',
      pass,
      `Received count: ${receivedPayloads.length}, Match found: ${!!matchingPayload}, sentAt: ${matchingPayload ? matchingPayload.sentAt : 'none'}`
    );
  } catch (err) {
    report('Test g: Webhook delivers POST payload with expected structure when SLA_WEBHOOK_URL is set', false, err.message);
  }

  await mongoose.disconnect();

  console.log(`\n========================================`);
  console.log(passedAll ? 'ALL SLA TESTS PASSED' : 'SOME SLA TESTS FAILED');
  console.log(`========================================\n`);

  process.exit(passedAll ? 0 : 1);
}

run().catch((err) => {
  console.error('Fatal error during SLA tests:', err);
  process.exit(1);
});

