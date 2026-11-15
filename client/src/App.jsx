import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Home from './pages/Home.jsx';
import Room from './pages/Room.jsx';
import { warmupServer } from './utils/serverUrl.js';

export default function App() {
  useEffect(() => {
    warmupServer();
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/dashboard" element={<Home />} />
      <Route path="/watch/:roomId" element={<Room />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
