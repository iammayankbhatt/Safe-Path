const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');

// Per-token rate limiter: max 5 reports per token per 24 hours
// Enforced at DB level (see POST handler)

// POST /api/reports — Submit a safety report
router.post('/', async (req, res) => {
  const { lat, lng, type, description, token } = req.body;

  // Validation
  if (!lat || !lng || !type || !token) {
    return res.status(400).json({ error: 'lat, lng, type, and token are required' });
  }

  const validTypes = ['unsafe', 'harassment', 'poorly_lit', 'isolated', 'suspicious'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (isNaN(latNum) || isNaN(lngNum) || latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: 'Invalid coordinates' });
  }

  if (description && description.length > 280) {
    return res.status(400).json({ error: 'Description must be 280 characters or less' });
  }

  try {
    // Rate limit: max 5 reports per token per 24 hours
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM reports 
       WHERE reporter_token = $1 
       AND created_at > NOW() - INTERVAL '24 hours'`,
      [token]
    );
    
    if (parseInt(countResult.rows[0].count) >= 5) {
      return res.status(429).json({
        error: 'Rate limit reached. Maximum 5 reports per 24 hours.',
      });
    }

    // Insert report
    const result = await pool.query(
      `INSERT INTO reports (location, report_type, description, reporter_token, recency_weight)
       VALUES (ST_MakePoint($1, $2)::GEOGRAPHY, $3, $4, $5, 1.0)
       RETURNING report_id, report_type, created_at`,
      [lngNum, latNum, type, description || null, token]
    );

    const report = result.rows[0];

    // Trigger async zone update (non-blocking)
    updateNearbyZones(lngNum, latNum).catch(console.error);

    res.status(201).json({
      success: true,
      report_id: report.report_id,
      type: report.report_type,
      submitted_at: report.created_at,
      message: 'Report submitted anonymously. Thank you for making streets safer.',
    });

  } catch (error) {
    console.error('Error submitting report:', error.message);
    res.status(500).json({ error: 'Failed to submit report' });
  }
});

// GET /api/reports/recent — Get recent reports (for map display, anonymized)
router.get('/recent', async (req, res) => {
  const { lat, lng, radius = 5000 } = req.query;

  try {
    let query;
    let params;

    if (lat && lng) {
      query = `
        SELECT 
          report_id,
          report_type,
          ST_Y(location::GEOMETRY) as lat,
          ST_X(location::GEOMETRY) as lng,
          created_at,
          recency_weight
        FROM reports
        WHERE ST_DWithin(location, ST_MakePoint($1, $2)::GEOGRAPHY, $3)
        AND created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
        LIMIT 200
      `;
      params = [parseFloat(lng), parseFloat(lat), parseFloat(radius)];
    } else {
      query = `
        SELECT 
          report_id,
          report_type,
          ST_Y(location::GEOMETRY) as lat,
          ST_X(location::GEOMETRY) as lng,
          created_at,
          recency_weight
        FROM reports
        WHERE created_at > NOW() - INTERVAL '30 days'
        ORDER BY created_at DESC
        LIMIT 500
      `;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json({ reports: result.rows, count: result.rows.length });

  } catch (error) {
    console.error('Error fetching reports:', error.message);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Update recency weights for all reports (called periodically)
async function updateRecencyWeights() {
  try {
    await pool.query(`
      UPDATE reports 
      SET recency_weight = exp(-EXTRACT(EPOCH FROM (NOW() - created_at)) / (30 * 86400))
      WHERE created_at > NOW() - INTERVAL '60 days'
    `);
  } catch (error) {
    console.error('Error updating recency weights:', error.message);
  }
}

// Update nearby zones after a new report
async function updateNearbyZones(lng, lat) {
  try {
    // Count reports within 100m
    const countResult = await pool.query(
      `SELECT COUNT(*), report_type
       FROM reports
       WHERE ST_DWithin(
         location,
         ST_MakePoint($1, $2)::GEOGRAPHY,
         100
       )
       AND created_at > NOW() - INTERVAL '30 days'
       GROUP BY report_type`,
      [lng, lat]
    );
    
    const totalReports = countResult.rows.reduce((sum, r) => sum + parseInt(r.count), 0);
    
    if (totalReports >= 3) {
      // Calculate safety score
      const unsafeCount = countResult.rows
        .filter(r => ['unsafe', 'harassment'].includes(r.report_type))
        .reduce((sum, r) => sum + parseInt(r.count), 0);
      
      const safetyScore = Math.max(1, 10 - (unsafeCount / totalReports) * 9);

      // Upsert zone
      await pool.query(
        `INSERT INTO safety_zones (centroid, radius_m, safety_score, report_count)
         VALUES (ST_MakePoint($1, $2)::GEOGRAPHY, 100, $3, $4)
         ON CONFLICT DO NOTHING`,
        [lng, lat, safetyScore, totalReports]
      );
    }
  } catch (error) {
    console.error('Error updating nearby zones:', error.message);
  }
}

module.exports = router;
