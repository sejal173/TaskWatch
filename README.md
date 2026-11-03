# TaskWatch

TaskWatch is a workflow automation and task monitoring platform built on the MERN stack (MongoDB, Express, React, Node.js) with Redis.

## Project Structure

```
TaskWatch/
├── server/
│   ├── src/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── worker/
│   │   ├── config/
│   │   │   └── db.js
│   │   └── index.js
│   ├── .env.example
│   └── package.json
├── client/
├── docker-compose.yml
├── .gitignore
└── README.md
```

## Getting Started

### Prerequisites
- Node.js (v18+ recommended)
- Docker & Docker Compose

### 1. Start Database & Cache
Start MongoDB and Redis using Docker Compose:
```bash
docker compose up -d
```

### 2. Configure Environment
Copy `.env.example` in the `server` directory to `.env`:
```bash
cd server
copy .env.example .env   # On Windows PowerShell / Command Prompt
# or
cp .env.example .env     # On macOS / Linux
```

### 3. Install Server Dependencies
```bash
cd server
npm install
```

### 4. Run the Server
Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

### 5. Health Check
Verify the server is running by hitting the health check endpoint:
```bash
curl http://localhost:5000/api/health
```
Expected response:
```json
{"status":"ok"}
```

