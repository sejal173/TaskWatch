# TaskWatch

## Overview

TaskWatch is a workflow automation and job monitoring platform featuring automated retries with exponential/fixed backoff, SLA breach alerts, a dead-letter queue (DLQ) with replay and discard controls, a comprehensive audit trail, and live updates over WebSockets.

---

## Tech Stack

- **Database**: MongoDB (Mongoose ODM)
- **Backend**: Express.js, Node.js (v20+)
- **Frontend**: React (Vite, JavaScript)
- **Queue & Background Jobs**: BullMQ backed by Redis
- **Realtime Updates**: Socket.IO with Redis pub/sub
- **Scheduled Jobs**: node-cron (SLA breach monitoring)
- **Logging**: Pino (structured JSON logging) with pino-http

---

## Architecture

TaskWatch follows a decoupled service architecture:

- **API Server** (`server/src/index.js`): Handles authentication (JWT), workflow and task management, job submissions, queue administration, metrics aggregation, audit trail querying, and WebSocket client connections via Socket.IO.
- **Worker Process** (`server/src/worker/index.js`): Runs as an isolated Node.js process listening on the BullMQ `workflow-jobs` queue to process workflow steps sequentially.
- **SLA Scheduler** (`server/src/services/slaChecker.js`): Periodic cron job that queries for active jobs exceeding their deadline, fires alerts, records audit events, and optionally dispatches webhooks.
- **Job State Transitions** (`server/src/services/transition.js`): Centralized state machine that validates transitions, persists job status, writes audit trail records, and emits realtime events.
- **Realtime Events** (`server/src/realtime/`): Redis pub/sub bridge (`events.js`) and Socket.IO handler (`socket.js`) that broadcast job status, queue state, and SLA alert events to connected browsers.
- **React Client** (`client/`): Single-page React dashboard built with Vite and TanStack Query, offering live metrics charts, workflow management, job execution monitoring, queue controls, dead-letter management, and audit logs.

---

## Prerequisites

- **Node.js**: v20 or higher
- **Docker Desktop**: For running containerized MongoDB and Redis services

---

## Setup

1. **Start database and cache containers**:
   ```bash
   docker compose up -d
   ```
2. **Install server dependencies**:
   ```bash
   cd server
   npm install
   ```
3. **Install client dependencies**:
   ```bash
   cd client
   npm install
   ```
4. **Configure environment**:
   Verify or create `server/.env`. The required values in `server/.env` are:
   ```env
   PORT=5000
   MONGO_URI=mongodb://localhost:27017/TaskWatch
   REDIS_HOST=localhost
   REDIS_PORT=6379
   LOG_LEVEL=info
   ```
   *(Note: The file also includes `JWT_SECRET=change_me`, `AUTH_RATE_LIMIT_MAX=10`, and `API_RATE_LIMIT_MAX=300`).*

---

## Running the Application

Run the application across four separate terminals:

1. **Terminal 1 - API Server**:
   ```bash
   cd server
   npm run dev
   ```
2. **Terminal 2 - Background Worker**:
   ```bash
   cd server
   npm run worker
   ```
3. **Terminal 3 - Frontend Client**:
   ```bash
   cd client
   npm run dev
   ```
4. **Terminal 4 - Web Browser**:
   Open the URL Vite prints in Terminal 3 (typically `http://localhost:5173`).

---

## Testing

> **Important**: MongoDB, Redis, the API server (`http://localhost:5000`), and the worker process must all be running before executing test suites.

The test scripts defined in `server/package.json` include:

- `npm run test:auth`: Authentication, registration, login, and JWT verification tests (`scripts/test-auth.js`).
- `npm run test:workflows`: Workflow and task CRUD, permission checks, and audit verification (`scripts/test-workflows.js`).
- `npm run test:jobs`: Job queue enqueueing, worker execution, failure handling, and query filtering (`scripts/test-jobs.js`).
- `npm run test:retries`: Retry backoff, max attempts, dead-letter queue, replay, and discard (`scripts/test-retries.js`).
- `npm run test:sla`: SLA deadline calculation, breach detection, idempotency, and webhook dispatch (`scripts/test-sla.js`).
- `npm run test:audit-queues`: Audit trail filtering and queue pause/resume controls (`scripts/test-audit-queues.js`).
- `npm run test:realtime`: Socket.IO authentication and live event emissions (`scripts/test-realtime.js`).
- `npm run test:metrics`: Dashboard summary metrics, ranges, and time-series aggregation (`scripts/test-metrics.js`).
- `npm run test:reliability`: Health probes, request body limits, JSON parsing guards, rate limiting, and stack trace leak prevention (`scripts/test-reliability.js`).

---

## Job Lifecycle

Job state transitions are strictly governed by the `ALLOWED` map defined in `server/src/services/transition.js`:

```javascript
const ALLOWED = {
  pending: ['running'],
  running: ['succeeded', 'retrying', 'dead_lettered', 'failed'],
  retrying: ['running', 'dead_lettered'],
  dead_lettered: ['pending', 'discarded'],
  succeeded: [],
  failed: [],
  discarded: [],
};
```

---

## Retry and Dead-Letter Rules

1. **Retryable Errors**: When a workflow step fails, the worker checks whether the error is retryable and whether attempts have not exceeded `maxAttempts`.
2. **Non-Retryable Errors**: If the error code is `INVALID_PAYLOAD` or the error message contains `INVALID_PAYLOAD`, the job is deemed non-retryable. It transitions immediately to `dead_lettered` with audit metadata `reason: "non_retryable"`, and is not retried.
3. **Max Attempts Exhausted**: If the error is retryable but the job has reached `maxAttempts`, it transitions to `dead_lettered` with audit metadata `reason: "max_attempts"`.
4. **Replay & Discard**: From `dead_lettered`, operators or admins can replay the job (which resets attempts and returns the status to `pending`) or discard it (transitioning the status to `discarded`).

---

## Troubleshooting

- **Docker / Services Not Running**:
  If MongoDB or Redis fails to connect (`ECONNREFUSED`), verify the containers are active:
  ```bash
  docker compose ps
  docker compose up -d
  ```
- **Port Already in Use**:
  - Port `5000`: Another instance of the API server or another service is listening on port 5000. Terminate the existing process before starting `npm run dev`.
  - Port `5173`: Vite will automatically pick the next available port (e.g., `5174`). Check the terminal output for the active URL.
- **Worker Needs Restart After Code Changes**:
  Because the worker process runs independently from the API server, any changes to `server/src/worker/` or shared services require restarting the worker process (`npm run worker`) for changes to take effect.
