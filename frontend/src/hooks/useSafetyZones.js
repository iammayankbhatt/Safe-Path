import { useState, useEffect, useCallback } from 'react';
import { getSafetyZones } from '../utils/api';

const REFRESH_INTERVAL = 60 * 1000; // 1 minute

export function useSafetyZones() {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchZones = useCallback(async () => {
    try {
      const res = await getSafetyZones();
      if (res.data && res.data.features) {
        setZones(res.data.features);
        setLastUpdated(new Date());
        setError(null);
      }
    } catch (err) {
      setError(err.message);
      console.warn('Failed to fetch safety zones:', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchZones();
    const interval = setInterval(fetchZones, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchZones]);

  return { zones, loading, error, lastUpdated, refetch: fetchZones };
}
