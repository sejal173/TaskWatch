import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import SummaryCard from '../components/SummaryCard';

export default function QueuesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canView = user?.role === 'admin' || user?.role === 'operator';
  const canControl = user?.role === 'admin';

  if (!canView) {
    return (
      <div className="page-container">
        <div className="page-header">
          <h2>Queue Management</h2>
        </div>
        <div className="error-message">
          Access denied. Only administrators and operators can view queue telemetry.
        </div>
      </div>
    );
  }

  // Poll queue statistics every 5 seconds
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['queueStats'],
    queryFn: async () => {
      const res = await api.get('/queues/stats');
      return res.data;
    },
    refetchInterval: 5000,
  });

  const isPaused = data?.paused || false;
  const counts = data?.counts || {};

  const handlePause = async () => {
    setActionError('');
    setSubmitting(true);
    try {
      await api.post('/queues/pause');
      await queryClient.invalidateQueries({ queryKey: ['queueStats'] });
      refetch();
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Failed to pause queue');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResume = async () => {
    setActionError('');
    setSubmitting(true);
    try {
      await api.post('/queues/resume');
      await queryClient.invalidateQueries({ queryKey: ['queueStats'] });
      refetch();
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Failed to resume queue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2>Queue Telemetry & Control</h2>
          <p className="subtitle">
            BullMQ worker queue: <strong>{data?.name || 'workflow-jobs'}</strong>
          </p>
        </div>

        {/* Admin Queue Controls */}
        {canControl && (
          <div className="btn-group">
            <button
              type="button"
              className="btn-action btn-discard"
              onClick={handlePause}
              disabled={isPaused || submitting}
              title="Pause queue processing"
            >
              ⏸ Pause Queue
            </button>
            <button
              type="button"
              className="btn-action btn-run"
              onClick={handleResume}
              disabled={!isPaused || submitting}
              title="Resume queue processing"
            >
              ▶ Resume Queue
            </button>
          </div>
        )}
      </div>

      {actionError && <div className="error-message">{actionError}</div>}

      {/* Queue Status Banner */}
      <div className="section-card queue-status-card">
        <div className="queue-status-left">
          <span className="status-label">Worker State:</span>
          <span className={`badge ${isPaused ? 'badge-yellow' : 'badge-green'}`}>
            {isPaused ? 'Paused' : 'Running'}
          </span>
        </div>
        <div className="queue-status-meta">
          <span>Auto-refreshes every 5s</span>
        </div>
      </div>

      {/* Queue Counts Grid */}
      <div className="cards-grid">
        <SummaryCard
          title="Waiting"
          count={counts.waiting}
          colorClass="card-blue"
          subtitle="Ready to be picked up by worker"
        />
        <SummaryCard
          title="Active"
          count={counts.active}
          colorClass="card-yellow"
          subtitle="Currently executing in runner"
        />
        <SummaryCard
          title="Delayed"
          count={counts.delayed}
          colorClass="card-purple"
          subtitle="Scheduled with backoff delay"
        />
        <SummaryCard
          title="Completed"
          count={counts.completed}
          colorClass="card-green"
          subtitle="Successfully finished jobs"
        />
        <SummaryCard
          title="Failed"
          count={counts.failed}
          colorClass="card-red"
          subtitle="Failed or dead-lettered jobs"
        />
      </div>

      {/* State Messages */}
      {isLoading && <div className="table-state-message">Loading queue metrics...</div>}
      {isError && (
        <div className="table-state-message error">
          Failed to connect to Redis queue. Ensure backend and Redis are running.
        </div>
      )}
    </div>
  );
}

