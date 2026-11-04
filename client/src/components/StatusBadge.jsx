export default function StatusBadge({ status }) {
  const normalized = status ? String(status).toLowerCase() : 'pending';

  let color = 'neutral';
  let label = normalized.replace(/_/g, ' ');

  switch (normalized) {
    case 'succeeded':
    case 'done':
    case 'active':
      color = 'success';
      label = normalized === 'active' ? 'Active' : normalized === 'done' ? 'Done' : 'Succeeded';
      break;
    case 'running':
    case 'in_progress':
      color = 'info';
      label = normalized === 'in_progress' ? 'In Progress' : 'Running';
      break;
    case 'retrying':
      color = 'warning';
      label = 'Retrying';
      break;
    case 'failed':
      color = 'danger';
      label = 'Failed';
      break;
    case 'dead_lettered':
      color = 'danger';
      label = 'Dead Letter';
      break;
    case 'queued':
      color = 'info';
      label = 'Queued';
      break;
    case 'pending':
      color = 'neutral';
      label = 'Pending';
      break;
    case 'discarded':
    case 'inactive':
      color = 'neutral';
      label = normalized === 'inactive' ? 'Inactive' : 'Discarded';
      break;
    default:
      color = 'neutral';
      label = status || 'Unknown';
  }

  return (
    <span className={`status-badge status-${color}`}>
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label">{label}</span>
    </span>
  );
}
