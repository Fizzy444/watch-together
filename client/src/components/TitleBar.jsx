import { useState, useEffect } from 'react';
import { Minus, Square, Copy, X, PlaySquare } from 'lucide-react';
import { isDesktopApp } from '../utils/serverUrl.js';

export default function TitleBar({ onMaximizeChange }) {
  const isDesktop = isDesktopApp();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!isDesktop) return;

    const checkMaximized = async () => {
      if (window.desktopAPI?.isWindowMaximized) {
        try {
          const max = await window.desktopAPI.isWindowMaximized();
          setIsMaximized(Boolean(max));
          onMaximizeChange?.(Boolean(max));
        } catch {}
      }
    };

    checkMaximized();
    window.addEventListener('resize', checkMaximized);
    return () => window.removeEventListener('resize', checkMaximized);
  }, [isDesktop, onMaximizeChange]);

  if (!isDesktop) return null;

  const handleMinimize = async (e) => {
    e.stopPropagation();
    try {
      await window.desktopAPI?.minimizeWindow();
    } catch (err) {
      console.warn('Failed to minimize window:', err);
    }
  };

  const handleToggleMaximize = async (e) => {
    e?.stopPropagation();
    try {
      await window.desktopAPI?.toggleMaximizeWindow();
      const max = await window.desktopAPI?.isWindowMaximized();
      setIsMaximized(Boolean(max));
      onMaximizeChange?.(Boolean(max));
    } catch (err) {
      console.warn('Failed to toggle maximize:', err);
    }
  };

  const handleClose = async (e) => {
    e.stopPropagation();
    try {
      await window.desktopAPI?.closeWindow();
    } catch (err) {
      console.warn('Failed to close window:', err);
    }
  };

  return (
    <header className="desktop-titlebar">
      <div
        className="desktop-titlebar-drag"
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none' }}>
          <PlaySquare size={14} color="var(--primary)" />
          <span className="desktop-titlebar-title">Watch Together</span>
        </div>
      </div>

      <div className="desktop-titlebar-controls" data-tauri-drag-region="false">
        <button
          type="button"
          className="desktop-titlebar-btn"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize"
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          className="desktop-titlebar-btn"
          onClick={handleToggleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Copy size={11} /> : <Square size={11} />}
        </button>
        <button
          type="button"
          className="desktop-titlebar-btn close"
          onClick={handleClose}
          title="Close"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>
    </header>
  );
}
