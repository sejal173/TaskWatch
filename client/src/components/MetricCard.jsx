export default function MetricCard({
  title,
  value,
  type = 'text',
  subtitle,
  colorClass = 'metric-default',
}) {
  let displayValue = '—';

  if (value !== undefined && value !== null) {
    if (type === 'percentage') {
      displayValue = `${value}%`;
    } else if (type === 'duration') {
      if (value < 1000) {
        displayValue = `${value} ms`;
      } else if (value < 60000) {
        const s = (value / 1000).toFixed(1);
        displayValue = `${s.endsWith('.0') ? s.slice(0, -2) : s} s`;
      } else {
        const mins = Math.round(value / 60000);
        displayValue = `${mins} min`;
      }
    } else {
      displayValue = String(value);
    }
  }

  return (
    <div className={`metric-card ${colorClass}`}>
      <div className="metric-header">
        <span className="metric-title">{title}</span>
      </div>
      <div className="metric-body">
        <span className="metric-value">{displayValue}</span>
        {subtitle && <span className="metric-subtitle">{subtitle}</span>}
      </div>
    </div>
  );
}

