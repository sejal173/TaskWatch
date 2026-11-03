import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../api/client';
import SummaryCard from '../components/SummaryCard';
import StatusBadge from '../components/StatusBadge';

export default function DashboardPage() {
  // Query running jobs count
  const { data: runningCount } = useQuery({
    queryKey: ['jobCount', 'running'],
    queryFn: async () => {
      const res = await api.get('/jobs?status=running&limit=1');
      return res.data.total;
    },
    refetchInterval: 5000,
  });

  // Query succeeded jobs count
  const { data: succeededCount } = useQuery({
    queryKey: ['jobCount', 'succeeded'],
    queryFn: async () => {
      const res = await api.get('/jobs?status=succeeded&limit=1');
      return res.data.total;
    },
    refetchInterval: 5000,
  });

  // Query retrying jobs count
  const { data: retryingCount } = useQuery({
    queryKey: ['jobCount', 'retrying'],
    queryFn: async () => {
      const res = await api.get('/jobs?status=retrying&limit=1');
      return res.data.total;
    },
    refetchInterval: 5000,
  });

  // Query dead-lettered jobs count
  const { data: deadLetterCount } = useQuery({
    queryKey: ['jobCount', 'dead_lettered'],
    queryFn: async () => {
      const res = await api.get('/jobs?status=dead_lettered&limit=1');
      return res.data.total;
    },
    refetchInterval: 5000,
  });

  // Query SLA breached jobs count
  const { data: slaBreachedCount } = useQuery({
    queryKey: ['jobCount', 'slaBreached'],
    queryFn: async () => {
      const res = await api.get('/jobs?slaBreached=true&limit=1');
      return res.data.total;
    },
    refetchInterval: 5000,
  });

  // Query 10 most recent jobs
  const { data: recentJobs, isLoading: isLoadingRecent, isError } = useQuery({
    queryKey: ['recentJobs'],
    queryFn: async () => {
      const res = await api.get('/jobs?limit=10');
      return res.data.items || [];
    },
    refetchInterval: 5000,
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' ' + d.toLocaleDateString();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2>System Overview</h2>
          <p className="subtitle">Real-time workflow execution and health metrics</p>
        </div>
      </div>

      {/* Summary Metrics Cards */}
      <div className="cards-grid">
        <SummaryCard
          title="Running"
          count={runningCount}
          colorClass="card-blue"
          subtitle="Actively processing"
        />
        <SummaryCard
          title="Succeeded"
          count={succeededCount}
          colorClass="card-green"
          subtitle="Completed successfully"
        />
        <SummaryCard
          title="Retrying"
          count={retryingCount}
          colorClass="card-yellow"
          subtitle="Scheduled for re-attempt"
        />
        <SummaryCard
          title="Dead Letter"
          count={deadLetterCount}
          colorClass="card-red"
          subtitle="Exhausted retries"
        />
        <SummaryCard
          title="SLA Breached"
          count={slaBreachedCount}
          colorClass="card-purple"
          subtitle="Missed SLA target"
        />
      </div>

      {/* Recent Jobs Section */}
      <div className="section-card">
        <div className="section-header">
          <div>
            <h3>Recent Jobs</h3>
            <span className="section-meta">Auto-refreshes every 5s</span>
          </div>
          <Link to="/jobs" className="btn-link">
            View All Jobs →
          </Link>
        </div>

        {isLoadingRecent ? (
          <div className="table-state-message">Loading recent jobs...</div>
        ) : isError ? (
          <div className="table-state-message error">Failed to load recent jobs</div>
        ) : !recentJobs || recentJobs.length === 0 ? (
          <div className="table-state-message">No jobs have been triggered yet.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Created</th>
                  <th>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {recentJobs.map((job) => (
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
                    <td className="date-cell">{formatDate(job.createdAt)}</td>
                    <td className="date-cell">{formatDate(job.deadlineAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
