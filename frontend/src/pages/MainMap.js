import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Circle, Marker, Popup, useMapEvents, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import { useGeolocation } from '../hooks/useGeolocation';
import { useSafetyZones } from '../hooks/useSafetyZones';
import { triggerPanic } from '../utils/api';
import { getTrustedContacts, queuePanicAlert } from '../utils/storage';
import styles from './MainMap.module.css';

// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom blue dot for user location
const userIcon = L.divIcon({
  className: '',
  html: `<div style="
    width:16px;height:16px;
    background:#4A90D9;border:3px solid #fff;
    border-radius:50%;box-shadow:0 0 0 4px rgba(74,144,217,0.25);
    position:relative;
  ">
    <div style="
      position:absolute;top:-4px;left:-4px;
      width:24px;height:24px;
      border-radius:50%;
      background:rgba(74,144,217,0.15);
      animation:ping 1.5s infinite;
    "></div>
  </div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// Report pin icon
const reportIcon = (type) => {
  const colors = {
    unsafe: '#E63946',
    harassment: '#E63946',
    poorly_lit: '#F4A261',
    isolated: '#F4A261',
    suspicious: '#F4A261',
  };
  const color = colors[type] || '#F4A261';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:10px;height:10px;
      background:${color};border:2px solid #fff;
      border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
};

// Map click handler component
function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng);
    },
  });
  return null;
}

export default function MainMap({ onReportLocation, onPanicActivated, onNavigate }) {
  const { location } = useGeolocation();
  const { zones, loading: zonesLoading, lastUpdated } = useSafetyZones();
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [panicLoading, setPanicLoading] = useState(false);
  const [bottomSheetOpen, setBottomSheetOpen] = useState(true);
  const mapRef = useRef(null);

  const MEERUT_CENTER = [28.9845, 77.7064];
  const DEFAULT_ZOOM = 13;

  // Pan to user location when it becomes available
  useEffect(() => {
    if (location && mapRef.current) {
      mapRef.current.setView([location.lat, location.lng], DEFAULT_ZOOM);
    }
  }, [location]);

  const handleMapClick = useCallback((latlng) => {
    setSelectedLocation(latlng);
  }, []);

  const handleReportHere = () => {
    const loc = selectedLocation || location || { lat: MEERUT_CENTER[0], lng: MEERUT_CENTER[1] };
    onReportLocation(loc);
  };

  const handlePanic = async () => {
    if (panicLoading) return;
    setPanicLoading(true);

    const loc = location || { lat: MEERUT_CENTER[0], lng: MEERUT_CENTER[1] };
    const contacts = getTrustedContacts();

    try {
      let alertId = null;

      if (navigator.onLine) {
        const res = await triggerPanic({
          lat: loc.lat,
          lng: loc.lng,
          contacts,
        });
        alertId = res.data.alert_id;
      } else {
        // Queue for when connectivity returns
        queuePanicAlert({ lat: loc.lat, lng: loc.lng, contacts });
        alertId = 'offline-' + Date.now();
      }

      onPanicActivated(alertId);
    } catch (err) {
      console.error('Panic trigger failed:', err);
      // Still activate panic screen even if API fails
      queuePanicAlert({ lat: loc.lat, lng: loc.lng, contacts });
      onPanicActivated('queued-' + Date.now());
    } finally {
      setPanicLoading(false);
    }
  };

  const getZoneColor = (score) => {
    if (score >= 7) return '#2DC653';
    if (score >= 4) return '#F4A261';
    return '#E63946';
  };

  const getZoneOpacity = (score) => {
    if (score >= 7) return 0.2;
    if (score >= 4) return 0.3;
    return 0.4;
  };

  return (
    <div className={styles.container}>
      {/* Leaflet Map */}
      <MapContainer
        center={MEERUT_CENTER}
        zoom={DEFAULT_ZOOM}
        zoomControl={false}
        className={styles.map}
        whenCreated={(map) => { mapRef.current = map; }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
          maxZoom={19}
        />
        <ZoomControl position="bottomright" />
        <MapClickHandler onMapClick={handleMapClick} />

        {/* User location dot */}
        {location && (
          <Marker position={[location.lat, location.lng]} icon={userIcon}>
            <Popup>
              <div style={{ textAlign: 'center', minWidth: 120 }}>
                <strong>You are here</strong>
                <br />
                <small style={{ color: '#666' }}>
                  {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                </small>
              </div>
            </Popup>
          </Marker>
        )}

        {/* Safety zone circles */}
        {zones.map((feature) => {
          const { zone_id, safety_score, radius_m, report_count, zone_type } = feature.properties;
          const [lng, lat] = feature.geometry.coordinates;
          const score = parseFloat(safety_score);
          const color = getZoneColor(score);

          return (
            <Circle
              key={zone_id}
              center={[lat, lng]}
              radius={radius_m}
              pathOptions={{
                fillColor: color,
                fillOpacity: getZoneOpacity(score),
                color: color,
                weight: 1.5,
                opacity: 0.6,
              }}
            >
              <Popup>
                <div style={{ minWidth: 140 }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    marginBottom: 6,
                  }}>
                    <span style={{
                      width: 12, height: 12, borderRadius: '50%',
                      background: color, display: 'inline-block',
                    }} />
                    <strong style={{ textTransform: 'capitalize' }}>
                      {zone_type} Zone
                    </strong>
                  </div>
                  <div style={{ fontSize: 13, color: '#555' }}>
                    <div>Safety Score: <strong>{score}/10</strong></div>
                    <div>Reports: <strong>{report_count}</strong></div>
                    <div>Radius: {radius_m}m</div>
                  </div>
                </div>
              </Popup>
            </Circle>
          );
        })}

        {/* Selected location marker */}
        {selectedLocation && (
          <Marker position={[selectedLocation.lat, selectedLocation.lng]}>
            <Popup>
              <div>
                <strong>Selected location</strong>
                <br />
                <button
                  onClick={handleReportHere}
                  style={{
                    marginTop: 6,
                    padding: '4px 10px',
                    background: '#E63946',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Report this spot
                </button>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.logo}>
          <span className={styles.logoIcon}>🛡️</span>
          <span className={styles.logoText}>SafePath</span>
        </div>
        <div className={styles.headerRight}>
          {zonesLoading ? (
            <span className={styles.badge} style={{ background: '#adb5bd' }}>Loading...</span>
          ) : (
            <span className={styles.badge}>
              {zones.length} zones live
            </span>
          )}
        </div>
      </div>

      {/* Map Legend */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={styles.dot} style={{ background: '#2DC653' }} />
          <span>Safe</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.dot} style={{ background: '#F4A261' }} />
          <span>Caution</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.dot} style={{ background: '#E63946' }} />
          <span>Avoid</span>
        </div>
      </div>

      {/* SOS Panic Button */}
      <button
        className={`${styles.panicBtn} ${panicLoading ? styles.panicBtnLoading : ''}`}
        onClick={handlePanic}
        disabled={panicLoading}
        aria-label="Emergency SOS"
      >
        {panicLoading ? (
          <span className={styles.spinner} />
        ) : (
          <>
            <span className={styles.panicIcon}>🆘</span>
            <span className={styles.panicText}>SOS</span>
          </>
        )}
      </button>

      {/* Bottom Sheet */}
      <div className={`${styles.bottomSheet} ${bottomSheetOpen ? styles.bottomSheetOpen : styles.bottomSheetClosed}`}>
        <button
          className={styles.sheetHandle}
          onClick={() => setBottomSheetOpen(!bottomSheetOpen)}
          aria-label="Toggle bottom sheet"
        >
          <div className={styles.handleBar} />
        </button>

        {bottomSheetOpen && (
          <div className={styles.sheetContent}>
            <button
              className={styles.actionBtn}
              onClick={handleReportHere}
            >
              <span>⚠️</span>
              <div>
                <div className={styles.actionBtnTitle}>Report Location</div>
                <div className={styles.actionBtnSub}>Tap map first, then report</div>
              </div>
            </button>

            <button
              className={`${styles.actionBtn} ${styles.actionBtnBlue}`}
              onClick={() => onNavigate('route')}
            >
              <span>🗺️</span>
              <div>
                <div className={styles.actionBtnTitle}>Plan Safe Route</div>
                <div className={styles.actionBtnSub}>Avoid danger zones</div>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
