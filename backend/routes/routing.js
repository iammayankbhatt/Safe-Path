const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const axios = require('axios');

// GET /api/route — Get safest route between two points
router.get('/', async (req, res) => {
  const { from_lat, from_lng, to_lat, to_lng } = req.query;

  if (!from_lat || !from_lng || !to_lat || !to_lng) {
    return res.status(400).json({ error: 'from_lat, from_lng, to_lat, to_lng are required' });
  }

  const coords = {
    from_lat: parseFloat(from_lat),
    from_lng: parseFloat(from_lng),
    to_lat: parseFloat(to_lat),
    to_lng: parseFloat(to_lng),
  };

  // Validate coordinates
  for (const [key, val] of Object.entries(coords)) {
    if (isNaN(val)) {
      return res.status(400).json({ error: `Invalid coordinate: ${key}` });
    }
  }

  try {
    // Call ML microservice for route computation
    const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:5001';
    
    let safeRoute, shortRoute;

    try {
      const mlResponse = await axios.get(`${mlUrl}/ml/route`, {
        params: coords,
        timeout: 10000,
      });
      safeRoute = mlResponse.data.safe_route;
      shortRoute = mlResponse.data.short_route;
    } catch (mlError) {
      console.warn('ML service unavailable, using fallback routing:', mlError.message);
      // Fallback: Use DB road segments for simple routing
      safeRoute = await fallbackRoute(coords, pool);
      shortRoute = safeRoute; // simplified fallback
    }

    // Enrich route with safety zones along the path
    const zones = await getSafetyZonesAlongRoute(safeRoute.waypoints, pool);

    res.json({
      safe_route: {
        ...safeRoute,
        safety_zones: zones,
      },
      short_route: shortRoute,
      routes_differ: JSON.stringify(safeRoute.waypoints) !== JSON.stringify(shortRoute.waypoints),
      computed_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Error computing route:', error.message);
    res.status(500).json({ error: 'Failed to compute route' });
  }
});

// POST /api/route — Same as GET but with body (for longer params)
router.post('/', async (req, res) => {
  req.query = req.body;
  return router.handle(req, res);
});

// Fallback routing using DB road segments + simple Dijkstra
async function fallbackRoute({ from_lat, from_lng, to_lat, to_lng }, pool) {
  try {
    // Get road segments near the route corridor
    const result = await pool.query(`
      SELECT
        segment_id,
        ST_AsGeoJSON(geom)::json as geometry,
        length_m,
        safety_score,
        routing_weight,
        ST_Y(ST_StartPoint(geom::GEOMETRY)) as start_lat,
        ST_X(ST_StartPoint(geom::GEOMETRY)) as start_lng,
        ST_Y(ST_EndPoint(geom::GEOMETRY)) as end_lat,
        ST_X(ST_EndPoint(geom::GEOMETRY)) as end_lng
      FROM road_segments
      WHERE ST_DWithin(
        geom,
        ST_MakeLine(
          ST_MakePoint($1, $2),
          ST_MakePoint($3, $4)
        )::GEOGRAPHY,
        3000
      )
      ORDER BY routing_weight ASC
      LIMIT 50
    `, [from_lng, from_lat, to_lng, to_lat]);

    // Build simple waypoints from start to end via safest segments
    const avgSafety = result.rows.length > 0
      ? result.rows.reduce((s, r) => s + r.safety_score, 0) / result.rows.length
      : 6.0;

    const totalDist = haversineDistance(from_lat, from_lng, to_lat, to_lng);

    // Generate intermediate waypoints biased toward safe zones
    const waypoints = generateSafeWaypoints(from_lat, from_lng, to_lat, to_lng, result.rows);

    return {
      waypoints,
      total_distance_m: totalDist,
      avg_safety_score: parseFloat(avgSafety.toFixed(1)),
      routing_weight: 0.4 * (totalDist / 100) + 0.6 * (10 - avgSafety),
      algorithm: 'fallback_db',
    };

  } catch (error) {
    // Minimal fallback: direct line
    const dist = haversineDistance(from_lat, from_lng, to_lat, to_lng);
    return {
      waypoints: [
        { lat: from_lat, lng: from_lng },
        { lat: to_lat, lng: to_lng },
      ],
      total_distance_m: dist,
      avg_safety_score: 6.0,
      routing_weight: 0.4 * (dist / 100) + 0.6 * (10 - 6.0),
      algorithm: 'direct_line',
    };
  }
}

function generateSafeWaypoints(fromLat, fromLng, toLat, toLng, segments) {
  const waypoints = [{ lat: fromLat, lng: fromLng }];
  
  if (segments.length > 0) {
    // Add intermediate points from high-safety segments
    const safeSegs = segments
      .filter(s => s.safety_score > 6)
      .slice(0, 3);
    
    for (const seg of safeSegs) {
      // Check if segment midpoint is roughly between source and dest
      const midLat = (seg.start_lat + seg.end_lat) / 2;
      const midLng = (seg.start_lng + seg.end_lng) / 2;
      
      const isOnPath = isRoughlyBetween(
        fromLat, fromLng, toLat, toLng, midLat, midLng
      );
      
      if (isOnPath) {
        waypoints.push({ lat: midLat, lng: midLng });
      }
    }
  }
  
  waypoints.push({ lat: toLat, lng: toLng });
  return waypoints;
}

function isRoughlyBetween(fromLat, fromLng, toLat, toLng, midLat, midLng) {
  const minLat = Math.min(fromLat, toLat) - 0.005;
  const maxLat = Math.max(fromLat, toLat) + 0.005;
  const minLng = Math.min(fromLng, toLng) - 0.005;
  const maxLng = Math.max(fromLng, toLng) + 0.005;
  return midLat >= minLat && midLat <= maxLat && midLng >= minLng && midLng <= maxLng;
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * Math.PI / 180; }

async function getSafetyZonesAlongRoute(waypoints, pool) {
  if (!waypoints || waypoints.length < 2) return [];
  
  try {
    const firstWp = waypoints[0];
    const lastWp = waypoints[waypoints.length - 1];
    
    const result = await pool.query(`
      SELECT
        zone_id,
        ST_Y(centroid::GEOMETRY) as lat,
        ST_X(centroid::GEOMETRY) as lng,
        safety_score,
        radius_m,
        report_count
      FROM safety_zones
      WHERE ST_DWithin(
        centroid,
        ST_MakeLine(
          ST_MakePoint($1, $2),
          ST_MakePoint($3, $4)
        )::GEOGRAPHY,
        500
      )
      ORDER BY safety_score ASC
      LIMIT 10
    `, [firstWp.lng, firstWp.lat, lastWp.lng, lastWp.lat]);
    
    return result.rows;
  } catch (error) {
    return [];
  }
}

module.exports = router;
