import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';

/**
 * Stacked bar chart showing execution volume by status over time.
 * Supports hourly formatting for 24h and daily formatting for 7d/30d.
 */
export default function RunsChart({ timeseries = [], range = '24h' }) {
  const totalRuns = timeseries.reduce(
    (acc, b) => acc + (b.succeeded || 0) + (b.failed || 0) + (b.dead_lettered || 0),
    0
  );

  const formatXAxis = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;

    if (range === '24h') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatTooltipLabel = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;

    if (range === '24h') {
      return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
    }
    return d.toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const legendFormatter = (value) => {
    switch (value) {
      case 'succeeded':
        return 'Succeeded';
      case 'failed':
        return 'Failed';
      case 'dead_lettered':
        return 'Dead Letter';
      default:
        return value;
    }
  };

  return (
    <div className="chart-container">
      {totalRuns === 0 ? (
        <div className="chart-empty-message">
          <span className="empty-icon">📊</span>
          <p>No runs in this period</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={timeseries} margin={{ top: 10, right: 15, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="time"
              tickFormatter={formatXAxis}
              stroke="#64748b"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
            />
            <YAxis
              allowDecimals={false}
              stroke="#64748b"
              fontSize={12}
              tickLine={false}
              axisLine={{ stroke: '#cbd5e1' }}
            />
            <Tooltip
              labelFormatter={formatTooltipLabel}
              formatter={(value, name) => [value, legendFormatter(name)]}
              contentStyle={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '6px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                fontSize: '12px',
              }}
            />
            <Legend
              formatter={legendFormatter}
              wrapperStyle={{ paddingTop: '10px', fontSize: '13px' }}
            />
            <Bar dataKey="succeeded" name="succeeded" stackId="runs" fill="#10b981" />
            <Bar dataKey="failed" name="failed" stackId="runs" fill="#ef4444" />
            <Bar dataKey="dead_lettered" name="dead_lettered" stackId="runs" fill="#991b1b" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

