import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import './utils/desktopBridge.js';
import './index.css';
import App from './App.jsx';

// In Desktop packaged builds or file:// protocol, use HashRouter for local navigation.
// In web browsers, use standard BrowserRouter.
const isDesktop = window.location.protocol === 'file:' || Boolean(window.electronAPI || window.desktopAPI);
const Router = isDesktop ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>
);
