const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /api/stats — Public stats dashboard
router.get('/', async (req, res) => {
  try {
    const [
      reportStats,
      zoneStats,
      panicStats,
      recentActivity,
    ] = await Promise.all([
      // Report statistics
      pool.query(`
        SELECT
          COUNT(*) as total_reports,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as reports_today,
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as reports_this_week,
          COUNT(DISTINCT report_type) as unique_types
        FROM reports
      `),
      // Zone statistics
      pool.query(`
        SELECT
          COUNT(*) as total_zones,
          COUNT(CASE WHEN safety_score >= 7 THEN 1 END) as safe_zones,
          COUNT(CASE WHEN safety_score >= 4 AND safety_score < 7 THEN 1 END) as caution_zones,
          COUNT(CASE WHEN safety_score < 4 THEN 1 END) as danger_zones,
          ROUND(AVG(safety_score)::numeric, 2) as avg_safety_score
        FROM safety_zones
        WHERE last_updated > NOW() - INTERVAL '24 hours'
      `),
      // Panic alert statistics
      pool.query(`
        SELECT
          COUNT(*) as total_alerts,
          COUNT(CASE WHEN resolved_at IS NOT NULL THEN 1 END) as resolved_alerts,
          COUNT(CASE WHEN police_email_sent = true THEN 1 END) as police_notified
        FROM panic_alerts
      `),
      // Recent activity by type
      pool.query(`
        SELECT
          report_type,
          COUNT(*) as count,
          MAX(created_at) as last_seen
        FROM reports
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY report_type
        ORDER BY count DESC
      `),
    ]);

    res.set('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
    res.json({
      reports: {
        ...reportStats.rows[0],
        by_type: recentActivity.rows,
      },
      zones: zoneStats.rows[0],
      panic_alerts: panicStats.rows[0],
      platform: {
        name: 'SafePath',
        version: '1.0.0',
        city: 'Meerut, Uttar Pradesh',
        team: 'HAWKS - GEHU Haldwani',
        tagline: 'Know which streets are safe before you walk them.',
      },
      generated_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error fetching stats:', error.message);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;
