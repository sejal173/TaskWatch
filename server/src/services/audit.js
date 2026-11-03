const { AuditEvent } = require('../models');

/**
 * Record an audit event in the append-only AuditEvent collection.
 * Sanitizes before/after payloads to ensure passwordHash is never persisted.
 */
const recordAudit = async ({ action, entityType, entityId, actor, before = null, after = null }) => {
  const sanitize = (data) => {
    if (!data) return null;
    const obj = typeof data.toObject === 'function' ? data.toObject() : { ...data };
    delete obj.passwordHash;
    return obj;
  };

  return await AuditEvent.create({
    action,
    entityType,
    entityId,
    actor,
    before: sanitize(before),
    after: sanitize(after),
  });
};

module.exports = {
  recordAudit,
};

