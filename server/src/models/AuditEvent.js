const mongoose = require('mongoose');

// AuditEvent schema providing an immutable append-only audit trail of operations
const auditEventSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
    },
    entityType: {
      type: String,
      required: true,
      enum: ['workflow', 'task', 'job', 'user', 'queue', 'system'],
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: function () {
        return this.entityType !== 'queue' && this.entityType !== 'system';
      },
      default: null,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    before: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Guard against modifications and deletions to ensure audit events remain append-only
const blockedOperations = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'remove',
];

blockedOperations.forEach((operation) => {
  auditEventSchema.pre(operation, function () {
    throw new Error('AuditEvent is append-only');
  });
});

const AuditEvent = mongoose.model('AuditEvent', auditEventSchema);

module.exports = AuditEvent;

