export default function SummaryCard({ title, count, colorClass = 'card-default', subtitle }) {
  const displayCount = count !== undefined && count !== null ? count : '—';

  return (
    <div className={`summary-card ${colorClass}`}>
      <div className="card-header">
        <span className="card-title">{title}</span>
      </div>
      <div className="card-body">
        <span className="card-count">{displayCount}</span>
        {subtitle && <span className="card-subtitle">{subtitle}</span>}
      </div>
    </div>
  );
}

