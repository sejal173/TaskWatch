const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/TaskWatch';

const { User } = require('../src/models');

async function run() {
  console.log(`Connecting to MongoDB at ${MONGO_URI}...`);
  await mongoose.connect(MONGO_URI);

  const timestamp = Date.now();
  const password = 'Password123!';
  const adminEmail = `admin-metrics-${timestamp}@taskwatch.io`;
  const viewerEmail = `viewer-metrics-${timestamp}@taskwatch.io`;

  let passedAll = true;

  function report(name, pass, detail) {
    const label = pass ? 'PASS' : 'FAIL';
    if (!pass) passedAll = false;
    console.log(`[${label}] ${name} -> ${detail}`);
    return pass;
  }

  console.log('\n--- Setting up Test Users ---');

  // Register Admin
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Admin Metrics', email: adminEmail, password }),
  });
  await User.updateOne({ email: adminEmail }, { role: 'admin' });

  const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password }),
  });
  const adminData = await adminLoginRes.json();
  const adminToken = adminData.token;

  // Register Viewer
  await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Viewer Metrics', email: viewerEmail, password }),
  });
  const viewerLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: viewerEmail, password }),
  });
  const viewerData = await viewerLoginRes.json();
  const viewerToken = viewerData.token;

  console.log('\n--- Running Step 14 Metrics Tests ---');

  // a. Read /api/metrics/summary?range=24h and check keys
  let summary24h = null;
  try {
    const res = await fetch(`${BASE_URL}/api/metrics/summary?range=24h`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    summary24h = await res.json();

    const hasExpectedKeys =
      res.status === 200 &&
      summary24h &&
      summary24h.hasOwnProperty('totals') &&
      summary24h.hasOwnProperty('successRate') &&
      summary24h.hasOwnProperty('avgDurationMs') &&
      summary24h.hasOwnProperty('slaCompliance') &&
      summary24h.hasOwnProperty('timeseries');

    report(
      'a. GET /api/metrics/summary?range=24h returns 200 with all 5 metric sections',
      hasExpectedKeys,
      `Status: ${res.status}, Keys present: totals (${Boolean(summary24h?.totals)}), successRate (${summary24h?.successRate}), avgDurationMs (${summary24h?.avgDurationMs}), slaCompliance (${summary24h?.slaCompliance}), timeseries (${Array.isArray(summary24h?.timeseries)})`
    );
  } catch (err) {
    report('a. GET /api/metrics/summary?range=24h returns 200 with all 5 metric sections', false, err.message);
  }

  // b. range=bogus returns 400
  try {
    const res = await fetch(`${BASE_URL}/api/metrics/summary?range=bogus`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const data = await res.json();
    report(
      'b. GET /api/metrics/summary?range=bogus returns 400',
      res.status === 400 && Boolean(data.error),
      `Status: ${res.status}, Body: ${JSON.stringify(data)}`
    );
  } catch (err) {
    report('b. GET /api/metrics/summary?range=bogus returns 400', false, err.message);
  }

  // c. totals.total equals totals.succeeded + failed + dead_lettered + retrying + running + pending + discarded
  try {
    const totals = summary24h?.totals;
    const sum =
      (totals?.succeeded || 0) +
      (totals?.failed || 0) +
      (totals?.dead_lettered || 0) +
      (totals?.retrying || 0) +
      (totals?.running || 0) +
      (totals?.pending || 0) +
      (totals?.discarded || 0);

    const match = totals && typeof totals.total === 'number' && totals.total === sum;

    report(
      'c. totals.total equals sum of succeeded + failed + dead_lettered + retrying + running + pending + discarded',
      match,
      `totals.total: ${totals?.total}, calculated sum: ${sum}, breakdown: ${JSON.stringify(totals)}`
    );
  } catch (err) {
    report('c. totals.total equals sum check', false, err.message);
  }

  // d. timeseries has 24 entries for 24h and 7 for 7d
  try {
    const len24h = summary24h?.timeseries?.length;

    const res7d = await fetch(`${BASE_URL}/api/metrics/summary?range=7d`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const summary7d = await res7d.json();
    const len7d = summary7d?.timeseries?.length;

    const passes = len24h === 24 && len7d === 7;
    report(
      'd. timeseries has exactly 24 entries for 24h and 7 for 7d',
      passes,
      `24h count: ${len24h} (expected 24), 7d count: ${len7d} (expected 7)`
    );
  } catch (err) {
    report('d. timeseries has exactly 24 entries for 24h and 7 for 7d', false, err.message);
  }

  // e. Viewer can also read the endpoint (200)
  try {
    const res = await fetch(`${BASE_URL}/api/metrics/summary`, {
      headers: { Authorization: `Bearer ${viewerToken}` },
    });
    const data = await res.json();
    report(
      'e. Viewer can also read /api/metrics/summary (200)',
      res.status === 200 && Boolean(data.totals),
      `Status: ${res.status}, totals.total: ${data?.totals?.total}`
    );
  } catch (err) {
    report('e. Viewer can also read /api/metrics/summary (200)', false, err.message);
  }

  // f. Unauthenticated request returns 401
  try {
    const res = await fetch(`${BASE_URL}/api/metrics/summary`);
    const data = await res.json();
    report(
      'f. Unauthenticated request returns 401',
      res.status === 401 && Boolean(data.error),
      `Status: ${res.status}, Body: ${JSON.stringify(data)}`
    );
  } catch (err) {
    report('f. Unauthenticated request returns 401', false, err.message);
  }

  await mongoose.disconnect();

  console.log(`\n--- Metrics Tests Result: ${passedAll ? 'ALL PASSED' : 'SOME FAILED'} ---`);
  if (!passedAll) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error running metrics tests:', err);
  process.exit(1);
});

