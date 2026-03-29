import React, { useState, useEffect } from 'react';
import MainMap from './pages/MainMap';
import ReportModal from './components/ReportModal';
import RoutePlanner from './pages/RoutePlanner';
import PanicScreen from './pages/PanicScreen';
import SettingsPage from './pages/SettingsPage';
import StatsPage from './pages/StatsPage';
import Navbar from './components/Navbar';
import OfflineBanner from './components/OfflineBanner';
import InstallPrompt from './components/InstallPrompt';

export type Screen = 'map' | 'route' | 'panic' | 'settings' | 'stats';

export default function App() {
  const [screen, setScreen] = useState('map');
  const [reportModal, setReportModal] = useState(false);
  const [reportLocation, setReportLocation] = useState(null);
  const [panicAlertId, setPanicAlertId] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const online = () => setIsOnline(true);
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  const openReport = (latLng) => {
    setReportLocation(latLng);
    setReportModal(true);
  };

  const handlePanicActivated = (alertId) => {
    setPanicAlertId(alertId);
    setScreen('panic');
  };

  const handlePanicResolved = () => {
    setPanicAlertId(null);
    setScreen('map');
  };

  // Panic screen overlays everything
  if (screen === 'panic') {
    return (
      <PanicScreen
        alertId={panicAlertId}
        onResolved={handlePanicResolved}
      />
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {!isOnline && <OfflineBanner />}

      {/* Main content area */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {screen === 'map' && (
          <MainMap
            onReportLocation={openReport}
            onPanicActivated={handlePanicActivated}
            onNavigate={setScreen}
          />
        )}
        {screen === 'route' && (
          <RoutePlanner onNavigate={setScreen} />
        )}
        {screen === 'settings' && (
          <SettingsPage onNavigate={setScreen} />
        )}
        {screen === 'stats' && (
          <StatsPage onNavigate={setScreen} />
        )}
      </div>

      {/* Bottom nav (hidden during panic) */}
      {screen !== 'panic' && (
        <Navbar currentScreen={screen} onNavigate={setScreen} />
      )}

      {/* Report modal */}
      {reportModal && (
        <ReportModal
          location={reportLocation}
          onClose={() => setReportModal(false)}
        />
      )}

      {/* PWA install prompt */}
      <InstallPrompt />
    </div>
  );
}
