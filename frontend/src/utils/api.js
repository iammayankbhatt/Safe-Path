import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Reports ─────────────────────────────────────────────────
export const submitReport = (data) => api.post('/api/reports', data);
export const getRecentReports = (params) => api.get('/api/reports/recent', { params });

// ─── Safety Zones ─────────────────────────────────────────────
export const getSafetyZones = () => api.get('/api/map/zones');
export const getHeatmapData = () => api.get('/api/map/heatmap');

// ─── Routing ──────────────────────────────────────────────────
export const getSafeRoute = (params) => api.get('/api/route', { params });

// ─── Panic ────────────────────────────────────────────────────
export const triggerPanic = (data) => api.post('/api/panic', data);
export const updatePanicLocation = (id, data) => api.patch(`/api/panic/${id}/location`, data);
export const cancelPanic = (id) => api.delete(`/api/panic/${id}`);

// ─── Stats ────────────────────────────────────────────────────
export const getStats = () => api.get('/api/stats');

// ─── Geocoding (Nominatim/OSM) ────────────────────────────────
export const geocodeAddress = async (query) => {
  const response = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: {
      q: query,
      format: 'json',
      limit: 5,
      countrycodes: 'in',
      viewbox: '77.6,28.85,77.85,29.05',
      bounded: 0,
    },
    headers: { 'Accept-Language': 'en' },
  });
  return response.data;
};

export const reverseGeocode = async (lat, lng) => {
  const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
    params: { lat, lon: lng, format: 'json' },
    headers: { 'Accept-Language': 'en' },
  });
  return response.data;
};

export default api;
