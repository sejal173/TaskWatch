const User = require('./User');
const Workflow = require('./Workflow');
const Task = require('./Task');
const Job = require('./Job');
const AuditEvent = require('./AuditEvent');

// Central export of all Mongoose models
module.exports = {
  User,
  Workflow,
  Task,
  Job,
  AuditEvent,
};

