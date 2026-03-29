import React, { useState, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Circle, ZoomControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import { getSafeRoute, geocodeAddress } from '../utils/api';
import styles from './RoutePlanner.module.css';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const startIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:24px;height:24px;
    background:#2DC653;border:3px solid #fff;
    border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);
    display:flex;align-items:center;justify-content:center;
    font-size:12px;
  ">🟢</div>`,
  iconSize: [24, 24], iconAnchor: [12, 12],
});

const endIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:24px;height:24px;
    background:#E63946;border:3px solid #fff;
    border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);
  "></div>`,
  iconSize: [24, 24], iconAnchor: [12, 12],
});

function FitBounds({ waypoints }) {
  const map = useMap();
  React.useEffect(() => {
    if (waypoints && waypoints.length >= 2) {
      const latlngs = waypoints.map(wp => [wp.lat, wp.lng]);
      map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] });
    }
  }, [waypoints, map]);
  return null;
}

export default function RoutePlanner({ onNavigate }) {
  const [fromQuery, setFromQuery] = useState('');
  const [toQuery, setToQuery] = useState('');
  const [fromSuggestions, setFromSuggestions] = useState([]);
  const [toSuggestions, setToSuggestions] = useState([]);
  const [fromCoords, setFromCoords] = useState(null);
  const [toCoords, setToCoords] = useState(null);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeInput, setActiveInput] = useState(null);
  const fromTimer = useRef(null);
  const toTimer = useRef(null);

  const MEERUT_CENTER = [28.9845, 77.7064];

  const handleFromSearch = (val) => {
    setFromQuery(val);
    setFromCoords(null);
    clearTimeout(fromTimer.current);
    if (val.length < 3) { setFromSuggestions([]); return; }
    fromTimer.current = setTimeout(async () => {
      try {
        const results = await geocodeAddress(val + ', Meerut');
        setFromSuggestions(results.slice(0, 4));
      } catch { setFromSuggestions([]); }
    }, 400);
  };

  const handleToSearch = (val) => {
    setToQuery(val);
    setToCoords(null);
    clearTimeout(toTimer.current);
    if (val.length < 3) { setToSuggestions([]); return; }
    toTimer.current = setTimeout(async () => {
      try {
        const results = await geocodeAddress(val + ', Meerut');
        setToSuggestions(results.slice(0, 4));
      } catch { setToSuggestions([]); }
    }, 400);
  };

  const selectFrom = (place) => {
    setFromQuery(place.display_name.split(',').slice(0, 2).join(','));
    setFromCoords({ lat: parseFloat(place.lat), lng: parseFloat(place.lon) });
    setFromSuggestions([]);
    setActiveInput(null);
  };

  const selectTo = (place) => {
    setToQuery(place.display_name.split(',').slice(0, 2).join(','));
    setToCoords({ lat: parseFloat(place.lat), lng: parseFloat(place.lon) });
    setToSuggestions([]);
    setActiveInput(null);
  };

  const findRoute = async () => {
    if (!fromCoords || !toCoords) {
      setError('Please select both start and destination from the suggestions.');
      return;
    }
    setLoading(true);
    setError('');
    setRoute(null);

    try {
      const res = await getSafeRoute({
        from_lat: fromCoords.lat,
        from_lng: fromCoords.lng,
        to_lat: toCoords.lat,
        to_lng: toCoords.lng,
      });
      setRoute(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to compute route. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const safeWaypoints = route?.safe_route?.waypoints?.map(wp => [wp.lat, wp.lng]) || [];
  const shortWaypoints = route?.short_route?.waypoints?.map(wp => [wp.lat, wp.lng]) || [];
  const safeScore = route?.safe_route?.avg_safety_score;
  const routesDiffer = route?.routes_differ;

  const scoreColor = (s) => s >= 7 ? '#2DC653' : s >= 4 ? '#F4A261' : '#E63946';
  const formatDist = (m) => m >= 1000 ? `${(m/1000).toFixed(1)} km` : `${Math.round(m)} m`;

  return (
    <div className={styles.container}>
      {/* Map */}
      <div className={styles.mapWrapper}>
        <MapContainer
          center={MEERUT_CENTER}
          zoom={13}
          zoomControl={false}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />
          <ZoomControl position="bottomright" />

          {/* Safe route (primary) */}
          {safeWaypoints.length >= 2 && (
            <Polyline
              positions={safeWaypoints}
              pathOptions={{ color: '#2DC653', weight: 5, opacity: 0.9 }}
            />
          )}

          {/* Short route (secondary, if different) */}
          {routesDiffer && shortWaypoints.length >= 2 && (
            <Polyline
              positions={shortWaypoints}
              pathOptions={{ color: '#adb5bd', weight: 3, opacity: 0.6, dashArray: '6 4' }}
            />
          )}

          {fromCoords && (
            <Marker position={[fromCoords.lat, fromCoords.lng]} icon={startIcon} />
          )}
          {toCoords && (
            <Marker position={[toCoords.lat, toCoords.lng]} icon={endIcon} />
          )}

          {/* Danger zones along route */}
          {route?.safe_route?.safety_zones?.map((zone, i) => (
            <Circle
              key={i}
              center={[zone.lat, zone.lng]}
              radius={zone.radius_m || 100}
              pathOptions={{
                fillColor: scoreColor(zone.safety_score),
                fillOpacity: 0.25,
                color: scoreColor(zone.safety_score),
                weight: 1,
              }}
            />
          ))}

          {safeWaypoints.length >= 2 && <FitBounds waypoints={route.safe_route.waypoints} />}
        </MapContainer>
      </div>

      {/* Panel */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <button className={styles.backBtn} onClick={() => onNavigate('map')}>
            ← Back
          </button>
          <h2 className={styles.panelTitle}>Safe Route Planner</h2>
        </div>

        {/* Inputs */}
        <div className={styles.inputSection}>
          <div className={styles.inputGroup}>
            <span className={styles.inputDot} style={{ background: '#2DC653' }} />
            <input
              className={styles.input}
              placeholder="From: Start location"
              value={fromQuery}
              onChange={(e) => handleFromSearch(e.target.value)}
              onFocus={() => setActiveInput('from')}
            />
          </div>
          {activeInput === 'from' && fromSuggestions.length > 0 && (
            <div className={styles.suggestions}>
              {fromSuggestions.map((s, i) => (
                <button key={i} className={styles.suggestionItem} onClick={() => selectFrom(s)}>
                  📍 {s.display_name.split(',').slice(0, 3).join(', ')}
                </button>
              ))}
            </div>
          )}

          <div className={styles.inputConnector}>|</div>

          <div className={styles.inputGroup}>
            <span className={styles.inputDot} style={{ background: '#E63946' }} />
            <input
              className={styles.input}
              placeholder="To: Destination"
              value={toQuery}
              onChange={(e) => handleToSearch(e.target.value)}
              onFocus={() => setActiveInput('to')}
            />
          </div>
          {activeInput === 'to' && toSuggestions.length > 0 && (
            <div className={styles.suggestions}>
              {toSuggestions.map((s, i) => (
                <button key={i} className={styles.suggestionItem} onClick={() => selectTo(s)}>
                  📍 {s.display_name.split(',').slice(0, 3).join(', ')}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={styles.findBtn}
          onClick={findRoute}
          disabled={loading || !fromCoords || !toCoords}
        >
          {loading ? <span className={styles.spinner} /> : '🗺️ Find Safest Route'}
        </button>

        {/* Route Results */}
        {route && (
          <div className={styles.results}>
            <div className={styles.routeCard} style={{ borderColor: '#2DC653' }}>
              <div className={styles.routeCardHeader}>
                <span className={styles.routeLabel}>🟢 Safest Route</span>
                <span className={styles.safetyScore} style={{ color: scoreColor(safeScore) }}>
                  {safeScore}/10 safety
                </span>
              </div>
              <div className={styles.routeStats}>
                <div className={styles.routeStat}>
                  <span className={styles.statVal}>{formatDist(route.safe_route.total_distance_m)}</span>
                  <span className={styles.statLabel}>Distance</span>
                </div>
                <div className={styles.routeStat}>
                  <span className={styles.statVal}>{route.safe_route.algorithm?.replace('_',' ')}</span>
                  <span className={styles.statLabel}>Algorithm</span>
                </div>
              </div>
            </div>

            {routesDiffer && (
              <div className={styles.routeCard} style={{ borderColor: '#adb5bd' }}>
                <div className={styles.routeCardHeader}>
                  <span className={styles.routeLabel}>⚪ Shortest Route</span>
                  <span className={styles.routeNote}>(may be less safe)</span>
                </div>
                <div className={styles.routeStats}>
                  <div className={styles.routeStat}>
                    <span className={styles.statVal}>{formatDist(route.short_route.total_distance_m)}</span>
                    <span className={styles.statLabel}>Distance</span>
                  </div>
                  <div className={styles.routeStat}>
                    <span className={styles.statVal} style={{ color: scoreColor(route.short_route.avg_safety_score) }}>
                      {route.short_route.avg_safety_score}/10
                    </span>
                    <span className={styles.statLabel}>Safety</span>
                  </div>
                </div>
              </div>
            )}

            <p className={styles.routeNote2}>
              ✅ SafePath prioritises safety (60%) over distance (40%) in every routing decision.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
