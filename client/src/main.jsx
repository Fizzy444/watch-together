import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import './utils/desktopBridge.js';
import { isDesktopApp } from './utils/serverUrl.js';
import './index.css';
import App from './App.jsx';

const Router = isDesktopApp() ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>
);
