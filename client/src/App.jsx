import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Home from './pages/Home.jsx';
import Room from './pages/Room.jsx';
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
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Home />} />
          <Route path="/watch/:roomId" element={<Room />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
