require('dotenv').config();
const express = require('express');
const connectDB = require('./config/db');
const authRouter = require('./routes/auth');
const workflowsRouter = require('./routes/workflows');
const tasksRouter = require('./routes/tasks');
const jobsRouter = require('./routes/jobs');

// Connect to MongoDB
connectDB();

const app = express();

// Middleware
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/jobs', jobsRouter);

// Routes
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

