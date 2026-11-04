const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/TaskWatch';
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

const { User, AuditEvent } = require('../src/models');

/**
 * Checks a string or object for leaking stack traces or internal server file paths.
 */
function containsStackOrPaths(text) {
  if (!text) return false;
  const str = typeof text === 'object' ? JSON.stringify(text) : String(text);
  const stackRegex = /"stack":|\bError:[\s\S]*?\bat\s+/;
  const pathRegex = /(?:[A-Za-z]:[\\\/]|(?:\.\.?[\\\/])+(?:src|node_modules)[\\\/]|server[\\\/]src)/;
  return stackRegex.test(str) || pathRegex.test(str);
}

async function run() {
  console.log(`Connecting to MongoDB at ${MONGO_URI}...`);
  await mongoose.connect(MONGO_URI);

  let passedAll = true;
  const recordedBodies = [];

  function report(name, pass, detail) {
    const label = pass ? 'PASS' : 'FAIL';
    if (!pass) passedAll = false;
    console.log(`[${label}] ${name} -> ${detail}`);
    return pass;
  }

  try {
    console.log('\n--- 1. Health Checks (a & b) ---');

    // a. GET /api/health
    const healthRes = await fetch(`${BASE_URL}/api/health`);
    const healthText = await healthRes.text();
    recordedBodies.push({ endpoint: 'GET /api/health', status: healthRes.status, body: healthText });
    let healthJson = {};
    try {
      healthJson = JSON.parse(healthText);
    } catch {}

    const isHealthOk =
      healthRes.status === 200 &&
      healthJson.status === 'ok' &&
      healthJson.mongo === 'up' &&
      healthJson.redis === 'up' &&
      typeof healthJson.uptime === 'number' &&
      healthJson.uptime >= 0;

    report(
      'Test (a) GET /api/health',
      isHealthOk,
      `status: ${healthRes.status}, body: ${JSON.stringify(healthJson)}`
    );

    // b. GET /api/health/live
    const liveRes = await fetch(`${BASE_URL}/api/health/live`);
    const liveText = await liveRes.text();
    recordedBodies.push({ endpoint: 'GET /api/health/live', status: liveRes.status, body: liveText });
    let liveJson = {};
    try {
      liveJson = JSON.parse(liveText);
    } catch {}

    const isLiveOk = liveRes.status === 200 && liveJson.status === 'ok';
    report(
      'Test (b) GET /api/health/live',
      isLiveOk,
      `status: ${liveRes.status}, body: ${JSON.stringify(liveJson)}`
    );

    console.log('\n--- 2. Request Validation Hardening (d & e) ---');

    // d. POST /api/auth/login with malformed JSON
    const malformedRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email": "broken, malformed json...',
    });
    const malformedText = await malformedRes.text();
    recordedBodies.push({
      endpoint: 'POST /api/auth/login (malformed)',
      status: malformedRes.status,
      body: malformedText,
    });
    let malformedJson = {};
    try {
      malformedJson = JSON.parse(malformedText);
    } catch {}

    const isMalformedOk =
      malformedRes.status === 400 && malformedJson.error === 'Invalid JSON body';
    report(
      'Test (d) Malformed JSON body handling',
      isMalformedOk,
      `status: ${malformedRes.status}, body: ${JSON.stringify(malformedJson)}`
    );

    // e. POST /api/auth/login with payload > 100 KB
    const largePayload = JSON.stringify({
      email: 'overflow@taskwatch.io',
      padding: 'x'.repeat(105 * 1024), // ~105 KB
    });

    const largeRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: largePayload,
    });
    const largeText = await largeRes.text();
    recordedBodies.push({
      endpoint: 'POST /api/auth/login (>100KB)',
      status: largeRes.status,
      body: largeText,
    });
    let largeJson = {};
    try {
      largeJson = JSON.parse(largeText);
    } catch {}

    const isLargeOk =
      (largeRes.status === 413 || largeRes.status === 400) &&
      !containsStackOrPaths(largeText);
    report(
      'Test (e) Body size > 100 KB payload limit',
      isLargeOk,
      `status: ${largeRes.status}, body: ${JSON.stringify(largeJson)}`
    );

    console.log('\n--- 3. Audit Model Cleanup for Queue Events (f) ---');

    // Setup an admin user directly to avoid consuming rate-limited login requests
    const adminUser = await User.findOneAndUpdate(
      { email: 'admin-reliability@taskwatch.io' },
      {
        name: 'Reliability Admin',
        email: 'admin-reliability@taskwatch.io',
        role: 'admin',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const adminToken = jwt.sign(
      { id: String(adminUser._id), role: adminUser.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Pause queue
    const pauseRes = await fetch(`${BASE_URL}/api/queues/pause`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const pauseText = await pauseRes.text();
    recordedBodies.push({ endpoint: 'POST /api/queues/pause', status: pauseRes.status, body: pauseText });
    let pauseJson = {};
    try {
      pauseJson = JSON.parse(pauseText);
    } catch {}

    // Resume queue
    const resumeRes = await fetch(`${BASE_URL}/api/queues/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const resumeText = await resumeRes.text();
    recordedBodies.push({ endpoint: 'POST /api/queues/resume', status: resumeRes.status, body: resumeText });
    let resumeJson = {};
    try {
      resumeJson = JSON.parse(resumeText);
    } catch {}

    // Query Audit API with entityType=queue
    const auditRes = await fetch(`${BASE_URL}/api/audit?entityType=queue`, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });
    const auditText = await auditRes.text();
    recordedBodies.push({ endpoint: 'GET /api/audit?entityType=queue', status: auditRes.status, body: auditText });
    let auditJson = {};
    try {
      auditJson = JSON.parse(auditText);
    } catch {}

    const queueAuditEvents = auditJson.items || [];
    const hasPausedEvent = queueAuditEvents.some(
      (e) => e.action === 'queue.paused' && e.entityType === 'queue' && e.entityId == null
    );
    const hasResumedEvent = queueAuditEvents.some(
      (e) => e.action === 'queue.resumed' && e.entityType === 'queue' && e.entityId == null
    );

    const isQueueAuditOk =
      pauseRes.status === 200 &&
      pauseJson.paused === true &&
      resumeRes.status === 200 &&
      resumeJson.paused === false &&
      auditRes.status === 200 &&
      hasPausedEvent &&
      hasResumedEvent;

    report(
      'Test (f) Admin pause/resume creates audit event with entityType="queue"',
      isQueueAuditOk,
      `pause: ${pauseRes.status}, resume: ${resumeRes.status}, audit status: ${auditRes.status}, found paused event: ${hasPausedEvent}, found resumed event: ${hasResumedEvent}`
    );

    console.log('\n--- 4. Auth Rate Limiting (c) ---');

    let eleventhStatus = null;
    let eleventhBody = null;
    let attemptsBefore429 = 0;

    for (let attempt = 1; attempt <= 11; attempt++) {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ratelimit-probe@taskwatch.io',
          password: 'WrongPassword123!',
        }),
      });
      const text = await res.text();
      recordedBodies.push({
        endpoint: `POST /api/auth/login (attempt ${attempt})`,
        status: res.status,
        body: text,
      });

      let json = {};
      try {
        json = JSON.parse(text);
      } catch {}

      if (attempt <= 10) {
        if (res.status === 401) {
          attemptsBefore429++;
        }
      } else if (attempt === 11) {
        eleventhStatus = res.status;
        eleventhBody = json;
      }
    }

    const isRateLimitOk =
      attemptsBefore429 === 10 &&
      eleventhStatus === 429 &&
      eleventhBody?.error === 'Too many attempts, try again later';

    report(
      'Test (c) 11 login attempts returns 429 on the 11th attempt',
      isRateLimitOk,
      `10 attempts returned 401: ${attemptsBefore429 === 10}, 11th status: ${eleventhStatus}, 11th body: ${JSON.stringify(eleventhBody)}`
    );

    console.log('\n--- 5. Response Inspection for Stack Traces & File Paths (g) ---');

    let leakFound = false;
    for (const item of recordedBodies) {
      if (containsStackOrPaths(item.body)) {
        leakFound = true;
        console.error(
          `LEAK DETECTED on ${item.endpoint} (Status ${item.status}):`,
          item.body
        );
      }
    }

    const isLeakFree = !leakFound;
    report(
      'Test (g) Inspect all response bodies; none contains "stack" or file paths',
      isLeakFree,
      `Inspected ${recordedBodies.length} response bodies. Leaks found: ${leakFound}`
    );
  } catch (err) {
    console.error('Unhandled test execution error:', err);
    passedAll = false;
  } finally {
    await mongoose.disconnect();
  }

  console.log('\n=======================================');
  if (passedAll) {
    console.log('ALL RELIABILITY TESTS PASSED');
    process.exit(0);
  } else {
    console.log('RELIABILITY TESTS FAILED');
    process.exit(1);
  }
}

run();

