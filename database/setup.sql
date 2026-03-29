-- SafePath Database Setup Script
-- PostgreSQL + PostGIS

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLE: reports
-- ============================================================
DROP TABLE IF EXISTS reports CASCADE;
CREATE TABLE reports (
  report_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location         GEOGRAPHY(POINT, 4326) NOT NULL,
  report_type      VARCHAR(20) NOT NULL CHECK (report_type IN ('unsafe','harassment','poorly_lit','isolated','suspicious')),
  description      TEXT,
  reporter_token   UUID NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  recency_weight   FLOAT DEFAULT 1.0,
  cluster_id       INTEGER
);
CREATE INDEX reports_location_idx ON reports USING GIST(location);
CREATE INDEX reports_token_idx ON reports(reporter_token);
CREATE INDEX reports_created_idx ON reports(created_at);

-- ============================================================
-- TABLE: safety_zones
-- ============================================================
DROP TABLE IF EXISTS safety_zones CASCADE;
CREATE TABLE safety_zones (
  zone_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  centroid       GEOGRAPHY(POINT, 4326) NOT NULL,
  radius_m       INTEGER DEFAULT 100,
  safety_score   FLOAT CHECK (safety_score BETWEEN 1 AND 10),
  report_count   INTEGER DEFAULT 0,
  last_updated   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX zones_centroid_idx ON safety_zones USING GIST(centroid);

-- ============================================================
-- TABLE: road_segments
-- ============================================================
DROP TABLE IF EXISTS road_segments CASCADE;
CREATE TABLE road_segments (
  segment_id         BIGINT PRIMARY KEY,
  geom               GEOGRAPHY(LINESTRING, 4326) NOT NULL,
  length_m           FLOAT,
  safety_score       FLOAT DEFAULT 7.0,
  routing_weight     FLOAT,
  last_score_update  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX road_geom_idx ON road_segments USING GIST(geom);

-- ============================================================
-- TABLE: panic_alerts
-- ============================================================
DROP TABLE IF EXISTS panic_alerts CASCADE;
CREATE TABLE panic_alerts (
  alert_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initial_location   GEOGRAPHY(POINT, 4326) NOT NULL,
  location_updates   JSONB DEFAULT '[]',
  contacts_notified  INTEGER DEFAULT 0,
  police_email_sent  BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  resolved_at        TIMESTAMPTZ
);

-- ============================================================
-- SEED DATA: ~200 mock reports around Meerut, Uttar Pradesh
-- ============================================================

-- Helper: Insert reports around Hapur Road (~60 reports)
INSERT INTO reports (location, report_type, description, reporter_token, created_at, recency_weight)
SELECT
  ST_MakePoint(
    77.7200 + (random() - 0.5) * 0.02,
    28.9780 + (random() - 0.5) * 0.02
  )::GEOGRAPHY,
  CASE (floor(random()*2))::int
    WHEN 0 THEN 'poorly_lit'
    ELSE 'harassment'
  END,
  CASE (floor(random()*3))::int
    WHEN 0 THEN 'Very poorly lit at night, street lights broken'
    WHEN 1 THEN 'Harassment incident reported near bus stop'
    ELSE 'Unsafe area after 8 PM'
  END,
  gen_random_uuid(),
  NOW() - (random() * 30 || ' days')::interval,
  exp(-random() * 30 / 30)
FROM generate_series(1, 60);

-- Helper: Insert reports around Begum Bridge (~50 reports)
INSERT INTO reports (location, report_type, description, reporter_token, created_at, recency_weight)
SELECT
  ST_MakePoint(
    77.7050 + (random() - 0.5) * 0.015,
    28.9900 + (random() - 0.5) * 0.015
  )::GEOGRAPHY,
  CASE (floor(random()*2))::int
    WHEN 0 THEN 'unsafe'
    ELSE 'isolated'
  END,
  CASE (floor(random()*3))::int
    WHEN 0 THEN 'Very isolated area, avoid at night'
    WHEN 1 THEN 'Suspicious activity near bridge'
    ELSE 'Dark and unsafe near bridge underpass'
  END,
  gen_random_uuid(),
  NOW() - (random() * 25 || ' days')::interval,
  exp(-random() * 25 / 30)
FROM generate_series(1, 50);

-- Helper: Insert reports near Shastri Nagar (~40 reports)
INSERT INTO reports (location, report_type, description, reporter_token, created_at, recency_weight)
SELECT
  ST_MakePoint(
    77.6950 + (random() - 0.5) * 0.018,
    28.9750 + (random() - 0.5) * 0.018
  )::GEOGRAPHY,
  'suspicious',
  CASE (floor(random()*3))::int
    WHEN 0 THEN 'Suspicious group of men near park'
    WHEN 1 THEN 'Unsafe feeling near this lane at night'
    ELSE 'Multiple incidents reported in this area'
  END,
  gen_random_uuid(),
  NOW() - (random() * 20 || ' days')::interval,
  exp(-random() * 20 / 30)
FROM generate_series(1, 40);

-- Safe scattered reports (~50 reports)
-- Note: In reality "safe" = absence of unsafe reports. These are neutral markers.
-- They won't form danger clusters (DBSCAN needs unsafe types)

-- ============================================================
-- SEED safety zones (pre-computed for demo)
-- ============================================================
INSERT INTO safety_zones (centroid, radius_m, safety_score, report_count, last_updated) VALUES
  (ST_MakePoint(77.7200, 28.9780)::GEOGRAPHY, 150, 2.5, 22, NOW()),
  (ST_MakePoint(77.7050, 28.9900)::GEOGRAPHY, 120, 2.0, 18, NOW()),
  (ST_MakePoint(77.6950, 28.9750)::GEOGRAPHY, 130, 3.0, 14, NOW()),
  (ST_MakePoint(77.7100, 28.9850)::GEOGRAPHY, 100, 5.5, 8, NOW()),
  (ST_MakePoint(77.7300, 28.9920)::GEOGRAPHY, 100, 7.5, 3, NOW()),
  (ST_MakePoint(77.6800, 28.9800)::GEOGRAPHY, 100, 8.0, 2, NOW()),
  (ST_MakePoint(77.7150, 28.9650)::GEOGRAPHY, 110, 4.0, 11, NOW()),
  (ST_MakePoint(77.7000, 28.9700)::GEOGRAPHY, 100, 6.5, 5, NOW());

-- ============================================================
-- SEED road segments (basic Meerut grid for demo routing)
-- ============================================================
INSERT INTO road_segments (segment_id, geom, length_m, safety_score, routing_weight) VALUES
  (1001, ST_MakeLine(ST_MakePoint(77.6900, 28.9700), ST_MakePoint(77.7100, 28.9700))::GEOGRAPHY, 1850, 7.5, 0.814),
  (1002, ST_MakeLine(ST_MakePoint(77.7100, 28.9700), ST_MakePoint(77.7300, 28.9700))::GEOGRAPHY, 1850, 6.0, 0.974),
  (1003, ST_MakeLine(ST_MakePoint(77.6900, 28.9850), ST_MakePoint(77.7100, 28.9850))::GEOGRAPHY, 1750, 8.0, 0.896),
  (1004, ST_MakeLine(ST_MakePoint(77.7100, 28.9850), ST_MakePoint(77.7300, 28.9850))::GEOGRAPHY, 1750, 3.5, 1.490),
  (1005, ST_MakeLine(ST_MakePoint(77.6900, 28.9700), ST_MakePoint(77.6900, 28.9850))::GEOGRAPHY, 1650, 7.0, 0.858),
  (1006, ST_MakeLine(ST_MakePoint(77.7100, 28.9700), ST_MakePoint(77.7100, 28.9850))::GEOGRAPHY, 1650, 2.5, 1.764),
  (1007, ST_MakeLine(ST_MakePoint(77.7300, 28.9700), ST_MakePoint(77.7300, 28.9850))::GEOGRAPHY, 1650, 7.8, 0.792),
  (1008, ST_MakeLine(ST_MakePoint(77.6900, 28.9850), ST_MakePoint(77.6900, 29.0000))::GEOGRAPHY, 1650, 6.5, 0.930),
  (1009, ST_MakeLine(ST_MakePoint(77.7100, 28.9850), ST_MakePoint(77.7100, 29.0000))::GEOGRAPHY, 1650, 4.0, 1.290),
  (1010, ST_MakeLine(ST_MakePoint(77.7300, 28.9850), ST_MakePoint(77.7300, 29.0000))::GEOGRAPHY, 1650, 8.5, 0.726),
  (1011, ST_MakeLine(ST_MakePoint(77.6900, 29.0000), ST_MakePoint(77.7100, 29.0000))::GEOGRAPHY, 1850, 7.2, 0.846),
  (1012, ST_MakeLine(ST_MakePoint(77.7100, 29.0000), ST_MakePoint(77.7300, 29.0000))::GEOGRAPHY, 1850, 8.0, 0.814),
  (1013, ST_MakeLine(ST_MakePoint(77.7000, 28.9700), ST_MakePoint(77.7000, 28.9850))::GEOGRAPHY, 1650, 2.0, 1.830),
  (1014, ST_MakeLine(ST_MakePoint(77.7200, 28.9700), ST_MakePoint(77.7200, 28.9850))::GEOGRAPHY, 1650, 2.8, 1.716),
  (1015, ST_MakeLine(ST_MakePoint(77.7000, 28.9850), ST_MakePoint(77.7200, 28.9850))::GEOGRAPHY, 1750, 3.2, 1.452);

-- Update routing weights
UPDATE road_segments
SET routing_weight = 0.4 * (length_m / 100) + 0.6 * (10 - safety_score);
