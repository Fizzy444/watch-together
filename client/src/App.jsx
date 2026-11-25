import { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import TitleBar from './components/TitleBar.jsx';
import { warmupServer, isDesktopApp } from './utils/serverUrl.js';

const Home = lazy(() => import('./pages/Home.jsx'));
const Room = lazy(() => import('./pages/Room.jsx'));
const Landing = lazy(() => import('./pages/Landing.jsx'));

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
        <Suspense
          fallback={
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="spinner" style={{ width: 32, height: 32 }} />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Home />} />
            <Route path="/landing" element={<Landing />} />
            <Route path="/watch/:roomId" element={<Room />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
