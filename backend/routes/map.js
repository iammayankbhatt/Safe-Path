const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /api/map/zones — Get all safety zones as GeoJSON
router.get('/zones', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        zone_id,
        ST_Y(centroid::GEOMETRY) as lat,
        ST_X(centroid::GEOMETRY) as lng,
        radius_m,
        safety_score,
        report_count,
        last_updated,
        CASE
          WHEN safety_score >= 7 THEN 'safe'
          WHEN safety_score >= 4 THEN 'caution'
          ELSE 'danger'
        END as zone_type
      FROM safety_zones
      WHERE last_updated > NOW() - INTERVAL '24 hours'
      ORDER BY safety_score ASC
    `);

    // Return as GeoJSON FeatureCollection
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map(zone => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [zone.lng, zone.lat],
        },
        properties: {
          zone_id: zone.zone_id,
          radius_m: zone.radius_m,
          safety_score: parseFloat(zone.safety_score).toFixed(1),
          report_count: zone.report_count,
          zone_type: zone.zone_type,
          last_updated: zone.last_updated,
          color: zone.zone_type === 'safe' ? '#2DC653' :
                 zone.zone_type === 'caution' ? '#F4A261' : '#E63946',
        },
      })),
      metadata: {
        total_zones: result.rows.length,
        generated_at: new Date().toISOString(),
      },
    };

    res.set('Cache-Control', 'public, max-age=60'); // Cache for 1 minute
    res.json(geojson);

  } catch (error) {
    console.error('Error fetching zones:', error.message);
    res.status(500).json({ error: 'Failed to fetch safety zones' });
  }
});

// GET /api/map/zones/bbox — Get zones within bounding box
router.get('/zones/bbox', async (req, res) => {
  const { minLng, minLat, maxLng, maxLat } = req.query;

  if (!minLng || !minLat || !maxLng || !maxLat) {
    return res.status(400).json({ error: 'minLng, minLat, maxLng, maxLat are required' });
  }

  try {
    const result = await pool.query(`
      SELECT
        zone_id,
        ST_Y(centroid::GEOMETRY) as lat,
        ST_X(centroid::GEOMETRY) as lng,
        radius_m,
        safety_score,
        report_count,
        last_updated
      FROM safety_zones
      WHERE ST_Within(
        centroid::GEOMETRY,
        ST_MakeEnvelope($1, $2, $3, $4, 4326)
      )
    `, [parseFloat(minLng), parseFloat(minLat), parseFloat(maxLng), parseFloat(maxLat)]);

    res.json({ zones: result.rows });

  } catch (error) {
    console.error('Error fetching zones by bbox:', error.message);
    res.status(500).json({ error: 'Failed to fetch safety zones' });
  }
});

// GET /api/map/heatmap — Get report density for heatmap overlay
router.get('/heatmap', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ST_Y(location::GEOMETRY) as lat,
        ST_X(location::GEOMETRY) as lng,
        recency_weight as intensity,
        report_type
      FROM reports
      WHERE created_at > NOW() - INTERVAL '30 days'
      ORDER BY created_at DESC
      LIMIT 1000
    `);

    res.json({
      points: result.rows,
      count: result.rows.length,
    });

  } catch (error) {
    console.error('Error fetching heatmap data:', error.message);
    res.status(500).json({ error: 'Failed to fetch heatmap data' });
  }
});

module.exports = router;
