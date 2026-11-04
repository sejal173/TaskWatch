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
          <span className="empty-icon" aria-hidden="true">📊</span>
          <p>No execution activity recorded in this time window</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={timeseries} margin={{ top: 12, right: 16, left: -8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="time"
              tickFormatter={formatXAxis}
              stroke="#94a3b8"
              fontSize={11}
              fontWeight={500}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
              dy={6}
            />
            <YAxis
              allowDecimals={false}
              stroke="#94a3b8"
              fontSize={11}
              fontWeight={500}
              tickLine={false}
              axisLine={{ stroke: '#e2e8f0' }}
              dx={-4}
            />
            <Tooltip
              labelFormatter={formatTooltipLabel}
              formatter={(value, name) => [value, legendFormatter(name)]}
              contentStyle={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08)',
                fontSize: '12px',
                padding: '8px 12px',
                color: '#0f172a',
              }}
              cursor={{ fill: 'rgba(241, 245, 249, 0.6)' }}
            />
            <Legend
              formatter={legendFormatter}
              wrapperStyle={{ paddingTop: '16px', fontSize: '12px', fontWeight: 500 }}
              iconType="circle"
              iconSize={8}
            />
            <Bar dataKey="succeeded" name="succeeded" stackId="runs" fill="#10b981" radius={[0, 0, 0, 0]} />
            <Bar dataKey="failed" name="failed" stackId="runs" fill="#ef4444" radius={[0, 0, 0, 0]} />
            <Bar dataKey="dead_lettered" name="dead_lettered" stackId="runs" fill="#991b1b" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
