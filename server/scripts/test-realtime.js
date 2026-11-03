const path = require('path');
const mongoose = require('mongoose');
const { io } = require('socket.io-client');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/TaskWatch';

const { User } = require('../src/models');

async function run() {
  console.log(`Connecting to MongoDB at ${MONGO_URI}...`);
  await mongoose.connect(MONGO_URI);

  const timestamp = Date.now();
  const password = 'Password123!';
  const adminEmail = `admin-realtime-${timestamp}@taskwatch.io`;

  let passedAll = true;

  function report(name, pass, detail) {
    const label = pass ? 'PASS' : 'FAIL';
    if (!pass) passedAll = false;
    console.log(`[${label}] ${name} -> ${detail}`);
    return pass;
  }

  console.log('\n--- Setting up Test Admin User ---');
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin Realtime', email: adminEmail, password }),
  });
  await User.updateOne({ email: adminEmail }, { role: 'admin' });

  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.token;

  console.log('\n--- Running Step 13 Realtime Tests ---');

  // a. Connecting with no token is rejected
  try {
    const result = await new Promise((resolve) => {
      const s = io(BASE_URL, {
        auth: {},
        transports: ['websocket', 'polling'],
        reconnection: false,
        timeout: 3000,
      });

      const timer = setTimeout(() => {
        s.close();
        resolve({ passed: false, error: 'Timed out waiting for rejection' });
      }, 3500);

      s.on('connect_error', (err) => {
        clearTimeout(timer);
        s.close();
        resolve({ passed: true, message: err.message });
      });

      s.on('connect', () => {
        clearTimeout(timer);
        s.close();
        resolve({ passed: false, error: 'Connected unexpectedly with no token' });
      });
    });

    report('a. Connecting with no token is rejected', result.passed, result.message || result.error);
  } catch (err) {
    report('a. Connecting with no token is rejected', false, err.message);
  }

  // b. Connecting with a garbage token is rejected
  try {
    const result = await new Promise((resolve) => {
      const s = io(BASE_URL, {
        auth: { token: 'invalid.garbage.token.here' },
        transports: ['websocket', 'polling'],
        reconnection: false,
        timeout: 3000,
      });

      const timer = setTimeout(() => {
        s.close();
        resolve({ passed: false, error: 'Timed out waiting for rejection' });
      }, 3500);

      s.on('connect_error', (err) => {
        clearTimeout(timer);
        s.close();
        resolve({ passed: true, message: err.message });
      });

      s.on('connect', () => {
        clearTimeout(timer);
        s.close();
        resolve({ passed: false, error: 'Connected unexpectedly with garbage token' });
      });
    });

    report('b. Connecting with a garbage token is rejected', result.passed, result.message || result.error);
  } catch (err) {
    report('b. Connecting with a garbage token is rejected', false, err.message);
  }

  // c. Connecting with a valid admin token succeeds
  let connectedSocket = null;
  try {
    const result = await new Promise((resolve) => {
      const s = io(BASE_URL, {
        auth: { token: adminToken },
        transports: ['websocket', 'polling'],
        reconnection: false,
        timeout: 4000,
      });

      const timer = setTimeout(() => {
        s.close();
        resolve({ passed: false, error: 'Timed out waiting for connection' });
      }, 4500);

      s.on('connect', () => {
        clearTimeout(timer);
        connectedSocket = s;
        resolve({ passed: true, socketId: s.id });
      });

      s.on('connect_error', (err) => {
        clearTimeout(timer);
        s.close();
        resolve({ passed: false, error: err.message });
      });
    });

    report('c. Connecting with a valid admin token succeeds', result.passed, `Socket ID: ${result.socketId || result.error}`);
  } catch (err) {
    report('c. Connecting with a valid admin token succeeds', false, err.message);
  }

  if (!connectedSocket) {
    console.error('Cannot proceed with event tests without an active socket connection.');
    await mongoose.disconnect();
    process.exit(1);
  }

  // Set up workflow for job tests
  const wfRes = await fetch(`${BASE_URL}/api/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    },
    body: JSON.stringify({
      name: `Realtime Test WF ${timestamp}`,
      description: 'Workflow for realtime testing',
      steps: [{ name: 'Log Step', order: 1, action: 'echo' }],
    }),
  });
  const wf = await wfRes.json();

  let createdJobId = null;

  // d. Creating a job via POST /api/jobs causes "job.updated" event to arrive within 5 seconds
  try {
    let targetJobId = null;

    const jobUpdatedPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connectedSocket.off('job.updated', onUpdate);
        reject(new Error('Timed out after 5s waiting for job.updated event'));
      }, 5000);

      function onUpdate(payload) {
        if (targetJobId && String(payload.jobId) === String(targetJobId)) {
          clearTimeout(timer);
          connectedSocket.off('job.updated', onUpdate);
          resolve(payload);
        }
      }

      connectedSocket.on('job.updated', onUpdate);
    });

    const jobRes = await fetch(`${BASE_URL}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        workflow: wf._id,
        input: { test: 'realtime' },
      }),
    });
    const jobData = await jobRes.json();
    createdJobId = String(jobData._id);
    targetJobId = createdJobId;

    const eventPayload = await jobUpdatedPromise;
    report(
      'd. Creating a job causes "job.updated" within 5s with matching jobId',
      String(eventPayload.jobId) === createdJobId,
      `Received event for jobId: ${eventPayload.jobId}, status: ${eventPayload.status}`
    );
  } catch (err) {
    report('d. Creating a job causes "job.updated" within 5s with matching jobId', false, err.message);
  }

  // e. Pausing the queue causes "queue.updated" event with paused: true. Resume afterwards.
  try {
    const queueUpdatedPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connectedSocket.off('queue.updated', onQueue);
        reject(new Error('Timed out after 5s waiting for queue.updated event'));
      }, 5000);

      function onQueue(payload) {
        if (payload && payload.paused === true) {
          clearTimeout(timer);
          connectedSocket.off('queue.updated', onQueue);
          resolve(payload);
        }
      }

      connectedSocket.on('queue.updated', onQueue);
    });

    const pauseRes = await fetch(`${BASE_URL}/api/queues/pause`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const pauseData = await pauseRes.json();

    const queuePayload = await queueUpdatedPromise;
    report(
      'e. Pausing the queue causes "queue.updated" with paused: true',
      queuePayload.paused === true && pauseData.paused === true,
      `Event received: { paused: ${queuePayload.paused} }`
    );

    // Resume queue afterwards
    await fetch(`${BASE_URL}/api/queues/resume`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  } catch (err) {
    report('e. Pausing the queue causes "queue.updated" with paused: true', false, err.message);
  }

  // f. Job reaching succeeded emits another "job.updated" event with status "succeeded"
  try {
    const succeededPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        connectedSocket.off('job.updated', onSucceeded);
        reject(new Error('Timed out after 10s waiting for job to succeed (worker required)'));
      }, 10000);

      function onSucceeded(payload) {
        if (String(payload.jobId) === String(createdJobId) && payload.status === 'succeeded') {
          clearTimeout(timer);
          connectedSocket.off('job.updated', onSucceeded);
          resolve(payload);
        }
      }

      connectedSocket.on('job.updated', onSucceeded);
    });

    const succPayload = await succeededPromise;
    report(
      'f. Job reaching succeeded emits "job.updated" with status "succeeded"',
      succPayload.status === 'succeeded',
      `Job ${succPayload.jobId} reached status: ${succPayload.status}`
    );
  } catch (err) {
    report('f. Job reaching succeeded emits "job.updated" with status "succeeded"', false, err.message);
  }

  // Cleanup
  if (connectedSocket) {
    connectedSocket.close();
  }
  await mongoose.disconnect();

  console.log(`\n--- Realtime Tests Result: ${passedAll ? 'ALL PASSED' : 'SOME FAILED'} ---`);
  if (!passedAll) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error running realtime tests:', err);
  process.exit(1);
});

