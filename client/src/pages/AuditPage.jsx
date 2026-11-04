import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function AuditPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState(new Set());

  const limit = 20;

  // Fetch audit records, refreshing every 10 seconds
  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit', page, entityType, action, entityId],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });

      if (entityType) params.append('entityType', entityType);
      if (action.trim()) params.append('action', action.trim());
      if (entityId.trim()) params.append('entityId', entityId.trim());

      const res = await api.get(`/audit?${params.toString()}`);
      return res.data;
    },
    enabled: isAdmin,
    refetchInterval: 10000,
  });

  // Strict role check for UI (rendered after hooks)
  if (!isAdmin) {
    return (
      <div className="page-container">
        <div className="page-header">
          <div>
            <h2>Audit Trail</h2>
            <p className="subtitle">Immutable compliance and operation logs</p>
          </div>
        </div>
        <div className="error-message">
          Admins only. You do not have permission to view audit logs.
        </div>
      </div>
    );
  }

  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
          ' ' +
          d.toLocaleDateString();
  };

  const shortenId = (id) => {
    if (!id) return '—';
    const s = String(id);
    return s.length > 8 ? `${s.substring(0, 4)}…${s.substring(s.length - 4)}` : s;
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2>Audit Trail</h2>
          <p className="subtitle">Immutable record of security and operational system events</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="section-card filter-card">
        <div className="form-row">
          <div className="form-group flex-1">
            <label htmlFor="filter-entity-type">Entity Type</label>
            <select
              id="filter-entity-type"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value);
                setPage(1);
              }}
              className="select-input full-width"
            >
              <option value="">All Entities</option>
              <option value="workflow">Workflow</option>
              <option value="task">Task</option>
              <option value="job">Job</option>
              <option value="user">User</option>
            </select>
          </div>

          <div className="form-group flex-1">
            <label htmlFor="filter-action">Action</label>
            <input
              id="filter-action"
              type="text"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              placeholder="e.g. job.created"
            />
          </div>

          <div className="form-group flex-1">
            <label htmlFor="filter-entity-id">Entity ID</label>
            <input
              id="filter-entity-id"
              type="text"
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value);
                setPage(1);
              }}
              placeholder="24-character ObjectId"
            />
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="section-card">
        {isLoading ? (
          <div className="table-state-message">
            <div className="spinner" />
            <span>Loading audit events...</span>
          </div>
        ) : isError ? (
          <div className="table-state-message error">Failed to load audit events. Check query parameters.</div>
        ) : items.length === 0 ? (
          <div className="table-state-message empty">
            <span className="empty-icon">🔍</span>
            <p>No audit events match the specified filter.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Entity Type</th>
                  <th>Entity ID</th>
                  <th>Actor</th>
                  <th>Changes</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const itemId = String(item._id || index);
                  const isExpanded = expandedIds.has(itemId);
                  return (
                    <React.Fragment key={itemId}>
                      <tr>
                        <td className="date-cell">{formatDate(item.createdAt)}</td>
                        <td>
                          <span className="action-tag">{item.action}</span>
                        </td>
                        <td>
                          <span className="entity-type-badge">{item.entityType}</span>
                        </td>
                        <td title={item.entityId}>
                          <code className="code-inline">{shortenId(item.entityId)}</code>
                        </td>
                        <td>
                          {item.actor ? (
                            <span className="actor-name" title={item.actor.email}>
                              {item.actor.name}
                            </span>
                          ) : (
                            <span className="text-muted">System</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            onClick={() => toggleExpand(itemId)}
                          >
                            {isExpanded ? 'Hide changes' : 'View changes'}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="diff-row">
                          <td colSpan="6">
                            <div className="diff-container">
                              <div className="diff-column">
                                <span className="diff-title">Before</span>
                                <pre className="json-pre">
                                  {item.before !== null && item.before !== undefined
                                    ? JSON.stringify(item.before, null, 2)
                                    : 'null'}
                                </pre>
                              </div>
                              <div className="diff-column">
                                <span className="diff-title">After</span>
                                <pre className="json-pre">
                                  {item.after !== null && item.after !== undefined
                                    ? JSON.stringify(item.after, null, 2)
                                    : 'null'}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        <div className="pagination-bar">
          <span className="pagination-info">
            Showing page {page} of {totalPages} ({total} total audit records)
          </span>
          <div className="pagination-controls">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
