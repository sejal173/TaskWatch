import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';

export default function JobsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [processingId, setProcessingId] = useState(null);

  const limit = 10;
  const canManage = user?.role === 'admin' || user?.role === 'operator';

  // Fetch jobs with filter and pagination, auto-refreshing every 5 seconds
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['jobs', page, statusFilter],
    queryFn: async () => {
      let url = `/jobs?page=${page}&limit=${limit}`;
      if (statusFilter) {
        url += `&status=${encodeURIComponent(statusFilter)}`;
      }
      const res = await api.get(url);
      return res.data;
    },
    refetchInterval: 5000,
  });

  const jobs = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const handleFilterChange = (e) => {
    setStatusFilter(e.target.value);
    setPage(1);
  };

  const handleReplay = async (jobId) => {
    setActionError('');
    setActionSuccess('');
    setProcessingId(jobId);
    try {
      await api.post(`/jobs/${jobId}/replay`);
      setActionSuccess(`Job ${jobId} successfully re-queued for execution`);
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['jobCount'] });
      refetch();
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Failed to replay job');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDiscard = async (jobId) => {
    setActionError('');
    setActionSuccess('');
    setProcessingId(jobId);
    try {
      await api.post(`/jobs/${jobId}/discard`);
      setActionSuccess(`Job ${jobId} marked as discarded`);
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['jobCount'] });
      refetch();
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Failed to discard job');
    } finally {
      setProcessingId(null);
    }
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

  const truncate = (str, len = 35) => {
    if (!str) return '—';
    return str.length > len ? str.substring(0, len) + '…' : str;
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2>Job Executions</h2>
          <p className="subtitle">Monitor and control workflow jobs across the cluster</p>
        </div>

        {/* Filter Toolbar */}
        <div className="filter-toolbar">
          <label htmlFor="status-filter">Status Filter:</label>
          <select
            id="status-filter"
            value={statusFilter}
            onChange={handleFilterChange}
            className="select-input"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="retrying">Retrying</option>
            <option value="dead_lettered">Dead Lettered</option>
            <option value="discarded">Discarded</option>
          </select>
        </div>
      </div>

      {/* Action Messages */}
      {actionError && <div className="error-message">{actionError}</div>}
      {actionSuccess && <div className="success-message">{actionSuccess}</div>}

      {/* Jobs Table Section */}
      <div className="section-card">
        {isLoading ? (
          <div className="table-state-message">Loading jobs...</div>
        ) : isError ? (
          <div className="table-state-message error">Error loading jobs</div>
        ) : jobs.length === 0 ? (
          <div className="table-state-message">No jobs found matching the selected filter.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Last Error</th>
                  <th>Created</th>
                  <th>Deadline</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job._id}>
                    <td>
                      <span className="workflow-title">
                        {job.workflow?.name || 'Unnamed Workflow'}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={job.status} />
                    </td>
                    <td>
                      <span className="attempts-text">
                        {job.attempts} of {job.maxAttempts}
                      </span>
                    </td>
                    <td className="error-cell" title={job.lastError || ''}>
                      {truncate(job.lastError)}
                    </td>
                    <td className="date-cell">{formatDate(job.createdAt)}</td>
                    <td className="date-cell">{formatDate(job.deadlineAt)}</td>
                    {canManage && (
                      <td className="actions-cell">
                        {job.status === 'dead_lettered' ? (
                          <div className="btn-group">
                            <button
                              type="button"
                              className="btn-action btn-replay"
                              onClick={() => handleReplay(job._id)}
                              disabled={processingId === job._id}
                              title="Replay this dead-lettered job"
                            >
                              Replay
                            </button>
                            <button
                              type="button"
                              className="btn-action btn-discard"
                              onClick={() => handleDiscard(job._id)}
                              disabled={processingId === job._id}
                              title="Discard this dead-lettered job"
                            >
                              Discard
                            </button>
                          </div>
                        ) : (
                          <span className="no-actions">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <div className="pagination-bar">
          <span className="pagination-info">
            Showing page {page} of {totalPages} ({total} total jobs)
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

