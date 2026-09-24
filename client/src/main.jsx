import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import './index.css';
import App from './App.jsx';

// In Electron packaged builds or file:// protocol, use HashRouter for local navigation.
// In web browsers, use standard BrowserRouter.
const isElectron = window.location.protocol === 'file:' || Boolean(window.electronAPI);
const Router = isElectron ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>
);
