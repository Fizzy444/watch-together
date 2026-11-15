import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Home from './pages/Home.jsx';
import Room from './pages/Room.jsx';
import TitleBar from './components/TitleBar.jsx';
import { warmupServer, isDesktopApp } from './utils/serverUrl.js';
import { getStoredUser, getStoredToken, fetchCurrentUserApi } from './utils/auth.js';

export default function App() {
  const isDesktop = isDesktopApp();
  const [isMaximized, setIsMaximized] = useState(false);
  const [currentUser, setCurrentUser] = useState(getStoredUser);

  useEffect(() => {
    warmupServer();
    if (getStoredToken()) {
      fetchCurrentUserApi().catch(() => {});
    }

    const handleAuthChange = (e) => {
      setCurrentUser(e.detail?.user || null);
    };
    window.addEventListener('wt-auth-changed', handleAuthChange);
    return () => window.removeEventListener('wt-auth-changed', handleAuthChange);
  }, []);

  return (
    <div className={`desktop-app-frame ${isDesktop ? 'is-desktop-window' : ''} ${isMaximized ? 'is-maximized' : ''}`}>
      <TitleBar onMaximizeChange={setIsMaximized} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Routes>
          <Route path="/" element={currentUser ? <Navigate to="/dashboard" replace /> : <Landing />} />
          <Route path="/dashboard" element={<Home />} />
          <Route path="/watch/:roomId" element={<Room />} />
          <Route path="*" element={<Navigate to={currentUser ? "/dashboard" : "/"} replace />} />
        </Routes>
      </div>
    </div>
  );
}
