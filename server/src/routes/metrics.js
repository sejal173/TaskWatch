const express = require('express');
const { Job } = require('../models');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const VALID_RANGES = ['24h', '7d', '30d'];

/**
 * GET /api/metrics/summary
 * Computes job execution metrics, durations, SLA compliance, and timeseries buckets.
 * Accepts ?range=24h, 7d, or 30d (default 24h).
 */
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const range = req.query.range || '24h';

    if (!VALID_RANGES.includes(range)) {
      return res.status(400).json({
        error: `Invalid range parameter "${range}". Valid values: 24h, 7d, 30d`,
      });
    }

    const now = new Date();
    const buckets = [];
    const bucketsMap = new Map();
    let rangeStartDate;

    if (range === '24h') {
      const currentHour = new Date(now);
      currentHour.setUTCMinutes(0, 0, 0, 0);

      for (let i = 23; i >= 0; i--) {
        const d = new Date(currentHour.getTime() - i * 3600 * 1000);
        const timeKey = d.toISOString();
        const bucket = { time: timeKey, succeeded: 0, failed: 0, dead_lettered: 0 };
        buckets.push(bucket);
        bucketsMap.set(timeKey, bucket);
      }
      rangeStartDate = new Date(currentHour.getTime() - 23 * 3600 * 1000);
    } else {
      const numDays = range === '7d' ? 7 : 30;
      const currentDay = new Date(now);
      currentDay.setUTCHours(0, 0, 0, 0);

      for (let i = numDays - 1; i >= 0; i--) {
        const d = new Date(currentDay.getTime() - i * 86400 * 1000);
        const timeKey = d.toISOString();
        const bucket = { time: timeKey, succeeded: 0, failed: 0, dead_lettered: 0 };
        buckets.push(bucket);
        bucketsMap.set(timeKey, bucket);
      }
      rangeStartDate = new Date(currentDay.getTime() - (numDays - 1) * 86400 * 1000);
    }

    const unit = range === '24h' ? 'hour' : 'day';

    // MongoDB Aggregation Pipeline
    const [aggResult] = await Job.aggregate([
      {
        $match: {
          createdAt: { $gte: rangeStartDate },
        },
      },
      {
        $facet: {
          statusCounts: [
            {
              $group: {
                _id: '$status',
                count: { $sum: 1 },
              },
            },
          ],
          avgDuration: [
            {
              $match: {
                status: 'succeeded',
                startedAt: { $ne: null },
                finishedAt: { $ne: null },
              },
            },
            {
              $project: {
                duration: { $subtract: ['$finishedAt', '$startedAt'] },
              },
            },
            {
              $group: {
                _id: null,
                avgMs: { $avg: '$duration' },
              },
            },
          ],
          slaMetrics: [
            {
              $match: {
                deadlineAt: { $ne: null },
              },
            },
            {
              $group: {
                _id: null,
                totalWithDeadline: { $sum: 1 },
                compliant: {
                  $sum: {
                    $cond: [{ $eq: ['$slaAlertedAt', null] }, 1, 0],
                  },
                },
              },
            },
          ],
          timeseriesAgg: [
            {
              $match: {
                status: { $in: ['succeeded', 'failed', 'dead_lettered'] },
              },
            },
            {
              $group: {
                _id: {
                  bucketTime: {
                    $dateTrunc: {
                      date: '$createdAt',
                      unit,
                    },
                  },
                  status: '$status',
                },
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]);

    // Build Totals
    const counts = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      retrying: 0,
      dead_lettered: 0,
      discarded: 0,
    };

    if (aggResult?.statusCounts) {
      for (const item of aggResult.statusCounts) {
        if (counts.hasOwnProperty(item._id)) {
          counts[item._id] = item.count;
        }
      }
    }

    const totalJobs =
      counts.succeeded +
      counts.failed +
      counts.dead_lettered +
      counts.retrying +
      counts.running +
      counts.pending +
      counts.discarded;

    const totals = {
      total: totalJobs,
      succeeded: counts.succeeded,
      failed: counts.failed,
      dead_lettered: counts.dead_lettered,
      retrying: counts.retrying,
      running: counts.running,
      pending: counts.pending,
      discarded: counts.discarded,
    };

    // Calculate Success Rate: succeeded / (succeeded + failed + dead_lettered)
    const finishedDenom = counts.succeeded + counts.failed + counts.dead_lettered;
    const successRate =
      finishedDenom > 0
        ? Math.round((counts.succeeded / finishedDenom) * 1000) / 10
        : null;

    // Calculate Average Duration (succeeded jobs only)
    let avgDurationMs = null;
    if (aggResult?.avgDuration?.length > 0 && typeof aggResult.avgDuration[0].avgMs === 'number') {
      avgDurationMs = Math.round(aggResult.avgDuration[0].avgMs);
    }

    // Calculate SLA Compliance: compliant / totalWithDeadline
    let slaCompliance = null;
    if (aggResult?.slaMetrics?.length > 0 && aggResult.slaMetrics[0].totalWithDeadline > 0) {
      const { compliant, totalWithDeadline } = aggResult.slaMetrics[0];
      slaCompliance = Math.round((compliant / totalWithDeadline) * 1000) / 10;
    }

    // Fill Timeseries Buckets from Aggregation
    if (aggResult?.timeseriesAgg) {
      for (const item of aggResult.timeseriesAgg) {
        const timeKey = new Date(item._id.bucketTime).toISOString();
        const bucket = bucketsMap.get(timeKey);
        if (bucket && bucket.hasOwnProperty(item._id.status)) {
          bucket[item._id.status] = item.count;
        }
      }
    }

    return res.status(200).json({
      totals,
      successRate,
      avgDurationMs,
      slaCompliance,
      timeseries: buckets,
    });
  } catch (error) {
    console.error('Error computing metrics summary:', error);
    return res.status(500).json({ error: 'Server error computing metrics summary' });
  }
});

module.exports = router;

