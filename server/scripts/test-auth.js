const crypto = require('crypto');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

// Helper to create JWT signed with arbitrary secret using Node built-in crypto
function createTokenWithSecret(payload, secret = 'wrong_secret') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

async function run() {
  const timestamp = Date.now();
  const testEmail = `test-${timestamp}@taskwatch.io`;
  const testPassword = 'ValidPassword123!';
  const testName = `Test User ${timestamp}`;

  let passedAll = true;
  let authToken = null;

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

  console.log(`Starting auth tests against ${BASE_URL}...\n`);

  // a. POST /api/auth/register with valid data returns 201, has a token, and the user has no passwordHash field
  const regResult = await check(
    'a. POST /api/auth/register (valid data)',
    () =>
      fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
      }),
    (status, body) =>
      status === 201 &&
      Boolean(body.token) &&
      body.user &&
      body.user.passwordHash === undefined &&
      !('passwordHash' in body.user)
  );

  if (regResult.pass && regResult.body && regResult.body.token) {
    authToken = regResult.body.token;
  }

  // b. POST /api/auth/register with the same email returns 409
  await check(
    'b. POST /api/auth/register (duplicate email)',
    () =>
      fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
      }),
    (status) => status === 409
  );

  // c. POST /api/auth/register with a password under 8 characters returns 400
  await check(
    'c. POST /api/auth/register (short password)',
    () =>
      fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: testName, email: `short-${Date.now()}@taskwatch.io`, password: 'short' }),
      }),
    (status) => status === 400
  );

  // d. POST /api/auth/register with missing fields returns 400
  await check(
    'd. POST /api/auth/register (missing fields)',
    () =>
      fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `missing-${Date.now()}@taskwatch.io` }),
      }),
    (status) => status === 400
  );

  // e. POST /api/auth/login with correct credentials returns 200 and a token
  const loginResult = await check(
    'e. POST /api/auth/login (correct credentials)',
    () =>
      fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      }),
    (status, body) => status === 200 && Boolean(body.token) && body.user && !('passwordHash' in body.user)
  );

  // Fallback if register token wasn't captured
  if (!authToken && loginResult.body && loginResult.body.token) {
    authToken = loginResult.body.token;
  }

  // f. POST /api/auth/login with a wrong password returns 401 and the message "Invalid email or password"
  await check(
    'f. POST /api/auth/login (wrong password)',
    () =>
      fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: 'WrongPassword123!' }),
      }),
    (status, body) => status === 401 && body.error === 'Invalid email or password'
  );

  // g. POST /api/auth/login with an unknown email returns 401 with the same message
  await check(
    'g. POST /api/auth/login (unknown email)',
    () =>
      fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `unknown-${Date.now()}@taskwatch.io`, password: testPassword }),
      }),
    (status, body) => status === 401 && body.error === 'Invalid email or password'
  );

  // h. GET /api/auth/me with the token returns 200 and the matching email
  await check(
    'h. GET /api/auth/me (valid token)',
    () =>
      fetch(`${BASE_URL}/api/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${authToken}` },
      }),
    (status, body) => status === 200 && body.user && body.user.email === testEmail.toLowerCase()
  );

  // i. GET /api/auth/me with no Authorization header returns 401
  await check(
    'i. GET /api/auth/me (no header)',
    () =>
      fetch(`${BASE_URL}/api/auth/me`, {
        method: 'GET',
      }),
    (status) => status === 401
  );

  // j. GET /api/auth/me with a garbage token returns 401
  await check(
    'j. GET /api/auth/me (garbage token)',
    () =>
      fetch(`${BASE_URL}/api/auth/me`, {
        method: 'GET',
        headers: { Authorization: 'Bearer this_is_a_garbage_token' },
      }),
    (status) => status === 401
  );

  // k. GET /api/auth/me with a token signed by a different secret returns 401
  const fakeToken = createTokenWithSecret({ id: '672740a8f9c1d2e3f4a5b6c7', role: 'admin' }, 'different_secret_key');
  await check(
    'k. GET /api/auth/me (different secret)',
    () =>
      fetch(`${BASE_URL}/api/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${fakeToken}` },
      }),
    (status) => status === 401
  );

  console.log('\n----------------------------------------');
  if (passedAll) {
    console.log('ALL AUTH TESTS PASSED!');
    process.exit(0);
  } else {
    console.error('SOME AUTH TESTS FAILED!');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});

