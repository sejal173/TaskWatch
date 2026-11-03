export default function StatusBadge({ status }) {
  const normalized = status ? String(status).toLowerCase() : 'pending';

  let colorClass = 'badge-gray';
  let label = normalized.replace('_', ' ');

  switch (normalized) {
    case 'succeeded':
      colorClass = 'badge-green';
      label = 'Succeeded';
      break;
    case 'running':
      colorClass = 'badge-blue';
      label = 'Running';
      break;
    case 'retrying':
      colorClass = 'badge-yellow';
      label = 'Retrying';
      break;
    case 'failed':
      colorClass = 'badge-red';
      label = 'Failed';
      break;
    case 'dead_lettered':
      colorClass = 'badge-red';
      label = 'Dead Letter';
      break;
    case 'pending':
      colorClass = 'badge-gray';
      label = 'Pending';
      break;
    case 'discarded':
      colorClass = 'badge-gray';
      label = 'Discarded';
      break;
    default:
      colorClass = 'badge-gray';
      label = status || 'Unknown';
  }

  return <span className={`badge ${colorClass}`}>{label}</span>;
}

