import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import './utils/desktopBridge.js';
import { isDesktopApp } from './utils/serverUrl.js';
import './index.css';
import App from './App.jsx';

function disableDevShortcuts(event) {
  const isF12 = event.key === 'F12';
  const isInspectCombo = event.ctrlKey && event.shiftKey && ['i', 'j', 'c'].includes(event.key.toLowerCase());
  const isViewSource = event.ctrlKey && event.key.toLowerCase() === 'u';

  if (isF12 || isInspectCombo || isViewSource) {
    event.preventDefault();
  }
}

function disableInspectMenu(event) {
  const tagName = event.target?.tagName?.toLowerCase();
  const isEditable = tagName === 'input' || tagName === 'textarea' || event.target?.isContentEditable;
  if (!isEditable) {
    event.preventDefault();
  }
}

if (import.meta.env.PROD || isDesktopApp()) {
  window.addEventListener('contextmenu', disableInspectMenu);
  window.addEventListener('keydown', disableDevShortcuts);
}

const Router = isDesktopApp() ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>
);
