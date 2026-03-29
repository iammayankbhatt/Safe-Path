import { useState, useEffect, useCallback } from 'react';

const DEFAULT_LOCATION = {
  lat: 28.9845,
  lng: 77.7064,
  accuracy: null,
};

export function useGeolocation() {
  const [location, setLocation] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const updateLocation = useCallback((position) => {
    setLocation({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      accuracy: position.coords.accuracy,
    });
    setLoading(false);
    setError(null);
  }, []);

  const handleError = useCallback((err) => {
    console.warn('Geolocation error:', err.message);
    setError(err.message);
    setLoading(false);
    // Fall back to Meerut center
    setLocation(DEFAULT_LOCATION);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      setLocation(DEFAULT_LOCATION);
      setLoading(false);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      updateLocation,
      handleError,
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      }
    );

    // Initial one-shot request for faster first load
    navigator.geolocation.getCurrentPosition(
      updateLocation,
      handleError,
      { enableHighAccuracy: false, timeout: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [updateLocation, handleError]);

  return { location, error, loading };
}
