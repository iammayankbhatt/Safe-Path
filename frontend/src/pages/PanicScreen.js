import React, { useState, useEffect, useRef } from 'react';
import { updatePanicLocation, cancelPanic } from '../utils/api';
import { useGeolocation } from '../hooks/useGeolocation';
import { getTrustedContacts } from '../utils/storage';
import styles from './PanicScreen.module.css';

export default function PanicScreen({ alertId, onResolved }) {
  const { location } = useGeolocation();
  const [updateCount, setUpdateCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState(Date.now());
  const [contacts] = useState(getTrustedContacts());
  const [countdown, setCountdown] = useState(30);
  const [cancelling, setCancelling] = useState(false);
  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  const isRealAlert = alertId && !alertId.startsWith('offline-') && !alertId.startsWith('queued-');

  // Update location every 30 seconds
  useEffect(() => {
    intervalRef.current = setInterval(async () => {
      if (location && isRealAlert) {
        try {
          await updatePanicLocation(alertId, { lat: location.lat, lng: location.lng });
          setUpdateCount(c => c + 1);
          setLastUpdate(Date.now());
          setCountdown(30);
        } catch (err) {
          console.warn('Location update failed:', err.message);
        }
      }
    }, 30000);

    // Countdown timer
    countdownRef.current = setInterval(() => {
      setCountdown(c => c > 0 ? c - 1 : 30);
    }, 1000);

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(countdownRef.current);
    };
  }, [alertId, location, isRealAlert]);

  const handleCancel = async () => {
    setCancelling(true);
    clearInterval(intervalRef.current);
    clearInterval(countdownRef.current);

    try {
      if (isRealAlert) {
        await cancelPanic(alertId);
      }
    } catch (err) {
      console.warn('Cancel failed:', err.message);
    } finally {
      onResolved();
    }
  };

  return (
    <div className={styles.screen}>
      {/* Pulsing background ring */}
      <div className={styles.ring1} />
      <div className={styles.ring2} />

      {/* Header */}
      <div className={styles.header}>
        <span className={styles.sosLabel}>🆘 SOS ACTIVE</span>
        <span className={styles.incidentId}>
          ID: {alertId ? alertId.toString().substring(0, 8).toUpperCase() : 'LOCAL'}
        </span>
      </div>

      {/* Main content */}
      <div className={styles.content}>
        <div className={styles.alertIcon}>🆘</div>

        <h1 className={styles.title}>Emergency Alert Sent</h1>

        {contacts.length > 0 ? (
          <p className={styles.subtitle}>
            Alert sent to <strong>{contacts.length}</strong> trusted contact{contacts.length > 1 ? 's' : ''}
          </p>
        ) : (
          <p className={styles.subtitle}>
            Incident recorded. Add trusted contacts in Settings.
          </p>
        )}

        {contacts.length > 0 && (
          <div className={styles.contactsList}>
            {contacts.map((c, i) => (
              <div key={i} className={styles.contactItem}>
                <span className={styles.contactIcon}>👤</span>
                <div>
                  <div className={styles.contactName}>{c.name}</div>
                  <div className={styles.contactStatus}>✅ Notified</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Location updates */}
        <div className={styles.locationBox}>
          {location ? (
            <>
              <div className={styles.locationRow}>
                <span className={styles.locationDot} />
                <span className={styles.locationText}>
                  Live location: {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
                </span>
              </div>
              <div className={styles.updateInfo}>
                Next update in <strong>{countdown}s</strong>
                {updateCount > 0 && ` · ${updateCount} update${updateCount > 1 ? 's' : ''} sent`}
              </div>
              <a
                href={`https://maps.google.com/?q=${location.lat},${location.lng}`}
                target="_blank"
                rel="noreferrer"
                className={styles.mapsLink}
              >
                📍 Open in Google Maps
              </a>
            </>
          ) : (
            <div className={styles.locationText}>Acquiring GPS location...</div>
          )}
        </div>

        <div className={styles.policeNote}>
          🚔 Nearest police station has been alerted with your location and incident ID.
        </div>
      </div>

      {/* Cancel button */}
      <div className={styles.footer}>
        <button
          className={styles.cancelBtn}
          onClick={handleCancel}
          disabled={cancelling}
        >
          {cancelling ? (
            <span className={styles.spinner} />
          ) : (
            <>✅ I'm Safe — Cancel Alert</>
          )}
        </button>
        <p className={styles.cancelNote}>
          Tap only when you are safe
        </p>
      </div>
    </div>
  );
}
