"""
SafePath ML Microservice
- DBSCAN clustering for danger zone detection
- Modified Dijkstra routing for safe path computation
"""

import os
import math
import json
import logging
from datetime import datetime, timezone

import numpy as np
import psycopg2
import psycopg2.extras
import networkx as nx
from flask import Flask, jsonify, request
from flask_cors import CORS
from sklearn.cluster import DBSCAN
from dotenv import load_dotenv

load_dotenv()

# ─── App Setup ───────────────────────────────────────────────
app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)


# ─── DB Connection ────────────────────────────────────────────
def get_db_connection():
    """Get a new database connection."""
    db_url = os.environ.get('DATABASE_URL')
    if db_url:
        conn = psycopg2.connect(db_url, sslmode='prefer')
    else:
        conn = psycopg2.connect(
            host=os.environ.get('DB_HOST', 'localhost'),
            port=int(os.environ.get('DB_PORT', 5432)),
            database=os.environ.get('DB_NAME', 'safepath'),
            user=os.environ.get('DB_USER', 'postgres'),
            password=os.environ.get('DB_PASSWORD', 'password'),
        )
    return conn


# ─── DBSCAN Clustering ────────────────────────────────────────
def run_dbscan_clustering():
    """
    Fetch reports from DB, run DBSCAN, update safety_zones table.

    DBSCAN params:
    - eps=0.001 degrees ≈ 100 metres
    - min_samples=3 (minimum 3 reports to form a danger zone)
    - metric='haversine' with ball_tree algorithm
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Fetch recent reports (last 60 days)
        cur.execute("""
            SELECT
                report_id,
                ST_Y(location::GEOMETRY) as lat,
                ST_X(location::GEOMETRY) as lng,
                report_type,
                created_at,
                recency_weight
            FROM reports
            WHERE created_at > NOW() - INTERVAL '60 days'
            ORDER BY created_at DESC
        """)
        reports = cur.fetchall()

        if len(reports) < 3:
            logger.info(f"Not enough reports for clustering: {len(reports)}")
            return {"clustered": 0, "zones_updated": 0, "message": "Not enough data"}

        logger.info(f"Running DBSCAN on {len(reports)} reports...")

        # Prepare coordinate matrix (lat, lng in radians for haversine)
        coords = np.array([[r['lat'], r['lng']] for r in reports])
        coords_rad = np.radians(coords)

        # Run DBSCAN
        # eps=0.001 degrees ≈ 100m; for haversine we use radians
        # 100m in radians = 100 / 6371000 ≈ 0.0000157
        eps_rad = 100 / 6371000  # 100 metres in radians

        db = DBSCAN(
            eps=eps_rad,
            min_samples=3,
            algorithm='ball_tree',
            metric='haversine',
        )
        labels = db.fit_predict(coords_rad)

        # Process each cluster
        unique_labels = set(labels) - {-1}  # -1 = noise
        logger.info(f"Found {len(unique_labels)} clusters")

        zones_updated = 0

        # Clear old zones and rebuild
        cur.execute("DELETE FROM safety_zones WHERE last_updated < NOW() - INTERVAL '16 minutes'")

        for cluster_id in unique_labels:
            cluster_mask = labels == cluster_id
            cluster_reports = [r for r, m in zip(reports, cluster_mask) if m]

            if len(cluster_reports) < 3:
                continue

            # Calculate cluster centroid
            cluster_lats = [r['lat'] for r in cluster_reports]
            cluster_lngs = [r['lng'] for r in cluster_reports]
            centroid_lat = np.mean(cluster_lats)
            centroid_lng = np.mean(cluster_lngs)

            # Calculate safety score
            # score = 10 - (2 × normalized_density × recency_weight)
            total_reports = len(cluster_reports)
            avg_recency = np.mean([r['recency_weight'] for r in cluster_reports])

            # Asymmetric trust: unsafe reports weighted 1.0, others lower
            unsafe_types = {'unsafe', 'harassment'}
            unsafe_count = sum(1 for r in cluster_reports if r['report_type'] in unsafe_types)
            unsafe_ratio = unsafe_count / total_reports

            # Density factor (normalized 0-1 based on report count)
            density_factor = min(1.0, total_reports / 20.0)

            # Safety score formula
            danger_score = 2 * density_factor * avg_recency * (0.7 + 0.3 * unsafe_ratio)
            safety_score = max(1.0, min(9.9, 10 - danger_score * 9))

            # Calculate radius (distance from centroid to farthest point)
            distances = [haversine_metres(centroid_lat, centroid_lng, r['lat'], r['lng'])
                         for r in cluster_reports]
            radius_m = max(100, min(500, int(max(distances) + 50)))

            # Upsert zone
            cur.execute("""
                INSERT INTO safety_zones (centroid, radius_m, safety_score, report_count, last_updated)
                VALUES (ST_MakePoint(%s, %s)::GEOGRAPHY, %s, %s, %s, NOW())
                ON CONFLICT DO NOTHING
            """, (centroid_lng, centroid_lat, radius_m, safety_score, total_reports))

            # Update road segments within this zone
            cur.execute("""
                UPDATE road_segments
                SET safety_score = %s,
                    routing_weight = 0.4 * (length_m / 100) + 0.6 * (10 - %s),
                    last_score_update = NOW()
                WHERE ST_DWithin(
                    geom,
                    ST_MakePoint(%s, %s)::GEOGRAPHY,
                    %s
                )
            """, (safety_score, safety_score, centroid_lng, centroid_lat, radius_m))

            # Update cluster_id in reports
            cur.execute("""
                UPDATE reports SET cluster_id = %s
                WHERE report_id = ANY(%s::uuid[])
            """, (cluster_id, [str(r['report_id']) for r in cluster_reports]))

            zones_updated += 1

        # Update recency weights for all reports
        cur.execute("""
            UPDATE reports
            SET recency_weight = exp(-EXTRACT(EPOCH FROM (NOW() - created_at)) / (30 * 86400))
            WHERE created_at > NOW() - INTERVAL '60 days'
        """)

        conn.commit()
        logger.info(f"✅ Clustering complete: {zones_updated} zones updated")

        return {
            "clustered": len(unique_labels),
            "zones_updated": zones_updated,
            "reports_processed": len(reports),
            "noise_points": int(np.sum(labels == -1)),
            "message": f"Successfully updated {zones_updated} danger zones",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    except Exception as e:
        conn.rollback()
        logger.error(f"Clustering error: {e}")
        raise
    finally:
        cur.close()
        conn.close()


# ─── Modified Dijkstra Routing ───────────────────────────────
def compute_safe_route(from_lat, from_lng, to_lat, to_lng):
    """
    Compute safest route using modified Dijkstra on road_segments graph.
    Edge weight = 0.4*(length_m/100) + 0.6*(10-safety_score)
    """
    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        # Fetch all road segments within bounding box + buffer
        buf = 0.02  # ~2km buffer
        min_lat = min(from_lat, to_lat) - buf
        max_lat = max(from_lat, to_lat) + buf
        min_lng = min(from_lng, to_lng) - buf
        max_lng = max(from_lng, to_lng) + buf

        cur.execute("""
            SELECT
                segment_id,
                ST_Y(ST_StartPoint(geom::GEOMETRY)) as start_lat,
                ST_X(ST_StartPoint(geom::GEOMETRY)) as start_lng,
                ST_Y(ST_EndPoint(geom::GEOMETRY)) as end_lat,
                ST_X(ST_EndPoint(geom::GEOMETRY)) as end_lng,
                length_m,
                safety_score,
                routing_weight
            FROM road_segments
            WHERE ST_Within(
                geom::GEOMETRY,
                ST_MakeEnvelope(%s, %s, %s, %s, 4326)
            )
        """, (min_lng, min_lat, max_lng, max_lat))

        segments = cur.fetchall()

        if not segments:
            logger.warning("No road segments found, using direct route")
            return build_direct_route(from_lat, from_lng, to_lat, to_lng)

        # Build NetworkX graph
        G = nx.DiGraph()

        for seg in segments:
            start_node = f"{seg['start_lat']:.4f},{seg['start_lng']:.4f}"
            end_node = f"{seg['end_lat']:.4f},{seg['end_lng']:.4f}"

            weight = seg['routing_weight'] if seg['routing_weight'] else (
                0.4 * (seg['length_m'] / 100) + 0.6 * (10 - (seg['safety_score'] or 7.0))
            )

            G.add_node(start_node, lat=seg['start_lat'], lng=seg['start_lng'])
            G.add_node(end_node, lat=seg['end_lat'], lng=seg['end_lng'])

            # Bidirectional edges
            G.add_edge(start_node, end_node,
                       weight=weight,
                       safety_score=seg['safety_score'],
                       length_m=seg['length_m'],
                       segment_id=seg['segment_id'])
            G.add_edge(end_node, start_node,
                       weight=weight,
                       safety_score=seg['safety_score'],
                       length_m=seg['length_m'],
                       segment_id=seg['segment_id'])

        # Find nearest graph nodes to source and destination
        source_node = find_nearest_node(G, from_lat, from_lng)
        dest_node = find_nearest_node(G, to_lat, to_lng)

        logger.info(f"Graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
        logger.info(f"Source: {source_node}, Dest: {dest_node}")

        # Safe route: Dijkstra with routing_weight (safety-biased)
        safe_path_nodes = None
        try:
            safe_path_nodes = nx.dijkstra_path(G, source_node, dest_node, weight='weight')
        except nx.NetworkXNoPath:
            logger.warning("No path found in graph, using direct route")

        # Short route: Dijkstra with only distance
        short_path_nodes = None
        try:
            # Temporarily set weights to length only
            for u, v, data in G.edges(data=True):
                data['length_weight'] = 0.4 * (data.get('length_m', 100) / 100)
            short_path_nodes = nx.dijkstra_path(G, source_node, dest_node, weight='length_weight')
        except nx.NetworkXNoPath:
            short_path_nodes = safe_path_nodes

        def path_to_route(path_nodes, graph):
            if not path_nodes:
                return build_direct_route(from_lat, from_lng, to_lat, to_lng)

            waypoints = [{'lat': from_lat, 'lng': from_lng}]
            total_dist = 0
            total_weight = 0
            safety_scores = []

            for node in path_nodes:
                node_data = graph.nodes[node]
                waypoints.append({
                    'lat': node_data['lat'],
                    'lng': node_data['lng'],
                })

            # Add actual destination
            waypoints.append({'lat': to_lat, 'lng': to_lng})

            # Calculate stats for edges
            for i in range(len(path_nodes) - 1):
                edge_data = graph.get_edge_data(path_nodes[i], path_nodes[i+1], {})
                total_dist += edge_data.get('length_m', 100)
                total_weight += edge_data.get('weight', 1.0)
                score = edge_data.get('safety_score', 7.0)
                if score:
                    safety_scores.append(score)

            avg_safety = float(np.mean(safety_scores)) if safety_scores else 6.0

            return {
                'waypoints': waypoints,
                'total_distance_m': total_dist,
                'avg_safety_score': round(avg_safety, 1),
                'routing_weight': round(total_weight, 3),
                'algorithm': 'dijkstra_networkx',
            }

        safe_route = path_to_route(safe_path_nodes, G)
        short_route = path_to_route(short_path_nodes, G)

        return safe_route, short_route

    except Exception as e:
        logger.error(f"Routing error: {e}")
        direct = build_direct_route(from_lat, from_lng, to_lat, to_lng)
        return direct, direct
    finally:
        cur.close()
        conn.close()


def build_direct_route(from_lat, from_lng, to_lat, to_lng):
    dist = haversine_metres(from_lat, from_lng, to_lat, to_lng)
    return {
        'waypoints': [
            {'lat': from_lat, 'lng': from_lng},
            {'lat': to_lat, 'lng': to_lng},
        ],
        'total_distance_m': dist,
        'avg_safety_score': 6.0,
        'routing_weight': round(0.4 * (dist / 100) + 0.6 * (10 - 6.0), 3),
        'algorithm': 'direct_line',
    }


def find_nearest_node(G, lat, lng):
    """Find the nearest node in the graph to given coordinates."""
    min_dist = float('inf')
    nearest = None
    for node, data in G.nodes(data=True):
        d = haversine_metres(lat, lng, data['lat'], data['lng'])
        if d < min_dist:
            min_dist = d
            nearest = node
    return nearest


def haversine_metres(lat1, lng1, lat2, lng2):
    """Calculate distance in metres between two lat/lng points."""
    R = 6371000
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat/2)**2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ─── Flask Endpoints ──────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        'status': 'ok',
        'service': 'SafePath ML Microservice',
        'version': '1.0.0',
        'timestamp': datetime.now(timezone.utc).isoformat(),
    })


@app.route('/ml/cluster', methods=['POST'])
def cluster():
    """Trigger DBSCAN clustering job."""
    logger.info("📊 Received clustering request")
    try:
        result = run_dbscan_clustering()
        return jsonify({'success': True, **result})
    except Exception as e:
        logger.error(f"Clustering failed: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/ml/route', methods=['GET'])
def route():
    """Compute safe route using modified Dijkstra."""
    from_lat = request.args.get('from_lat', type=float)
    from_lng = request.args.get('from_lng', type=float)
    to_lat = request.args.get('to_lat', type=float)
    to_lng = request.args.get('to_lng', type=float)

    if None in (from_lat, from_lng, to_lat, to_lng):
        return jsonify({'error': 'from_lat, from_lng, to_lat, to_lng are required'}), 400

    logger.info(f"🗺️  Route request: ({from_lat},{from_lng}) → ({to_lat},{to_lng})")

    try:
        safe_route, short_route = compute_safe_route(from_lat, from_lng, to_lat, to_lng)
        return jsonify({
            'success': True,
            'safe_route': safe_route,
            'short_route': short_route,
            'routes_differ': safe_route['waypoints'] != short_route['waypoints'],
        })
    except Exception as e:
        logger.error(f"Routing failed: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/ml/score', methods=['GET'])
def score_location():
    """Get safety score for a specific location."""
    lat = request.args.get('lat', type=float)
    lng = request.args.get('lng', type=float)
    radius = request.args.get('radius', 200, type=float)

    if lat is None or lng is None:
        return jsonify({'error': 'lat and lng are required'}), 400

    conn = get_db_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    try:
        cur.execute("""
            SELECT
                COUNT(*) as report_count,
                AVG(recency_weight) as avg_recency,
                COUNT(CASE WHEN report_type IN ('unsafe','harassment') THEN 1 END) as serious_reports
            FROM reports
            WHERE ST_DWithin(
                location,
                ST_MakePoint(%s, %s)::GEOGRAPHY,
                %s
            )
            AND created_at > NOW() - INTERVAL '30 days'
        """, (lng, lat, radius))

        stats = cur.fetchone()
        report_count = int(stats['report_count'])

        if report_count == 0:
            safety_score = 6.0
        else:
            avg_recency = float(stats['avg_recency'] or 1.0)
            serious_ratio = int(stats['serious_reports']) / report_count
            density = min(1.0, report_count / 15.0)
            danger = 2 * density * avg_recency * (0.5 + 0.5 * serious_ratio)
            safety_score = round(max(1.0, min(9.9, 10 - danger * 9)), 1)

        return jsonify({
            'lat': lat,
            'lng': lng,
            'safety_score': safety_score,
            'report_count': report_count,
            'zone_type': 'safe' if safety_score >= 7 else ('caution' if safety_score >= 4 else 'danger'),
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    port = int(os.environ.get('ML_PORT', 5001))
    host = os.environ.get('ML_HOST', '0.0.0.0')
    logger.info(f"\n🤖 SafePath ML Service starting on {host}:{port}\n")
    app.run(host=host, port=port, debug=os.environ.get('NODE_ENV') != 'production')
