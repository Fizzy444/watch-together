import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Room from './pages/Room.jsx';
import Landing from './pages/Landing.jsx';
import TitleBar from './components/TitleBar.jsx';
import { warmupServer, isDesktopApp } from './utils/serverUrl.js';

export default function App() {
  const isDesktop = isDesktopApp();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    warmupServer();
  }, []);

  return (
    <div className={`desktop-app-frame ${isDesktop ? 'is-desktop-window' : ''} ${isMaximized ? 'is-maximized' : ''}`}>
      <TitleBar onMaximizeChange={setIsMaximized} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/dashboard" element={<Home />} />
          <Route path="/landing" element={<Landing />} />
          <Route path="/watch/:roomId" element={<Room />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
