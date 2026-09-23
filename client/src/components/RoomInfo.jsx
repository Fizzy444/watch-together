import { useState } from 'react';
import { Link2, Check, Keyboard } from 'lucide-react';

export default function RoomInfo({ roomId }) {
  const [copied, setCopied] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const url = `${window.location.origin}/watch/${roomId}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const shortcuts = [
    { key: 'Space / K', desc: 'Play / Pause' },
    { key: '← / →', desc: 'Skip 5s' },
    { key: 'J / L', desc: 'Skip 10s' },
    { key: '↑ / ↓', desc: 'Volume' },
    { key: 'M', desc: 'Mute / Unmute' },
    { key: 'F', desc: 'Fullscreen' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
      <div>
        <div className="sidebar-title">Session Link</div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <input
            className="input"
            type="text"
            value={url}
            readOnly
            style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.75rem' }}
          />
          <button
            className="btn btn-secondary"
            style={{ padding: '0 var(--sp-3)' }}
            onClick={copyLink}
            title="Copy link"
          >
            {copied ? <Check size={16} color="var(--success)" /> : <Link2 size={16} />}
          </button>
        </div>
      </div>

      <div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowShortcuts((v) => !v)}
          style={{
            width: '100%',
            justifyContent: 'space-between',
            padding: 'var(--sp-2) var(--sp-1)',
            fontSize: '0.75rem',
            color: 'var(--text-2)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <Keyboard size={14} />
            Keyboard Shortcuts
          </span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>
            {showShortcuts ? 'Hide' : 'Show'}
          </span>
        </button>

        {showShortcuts && (
          <div
            style={{
              marginTop: 'var(--sp-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: 'var(--sp-2)',
              background: 'var(--bg-accent)',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
            }}
          >
            {shortcuts.map((s) => (
              <div
                key={s.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.75rem',
                }}
              >
                <kbd
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-hover)',
                    borderRadius: 'var(--r-sm)',
                    padding: '1px 6px',
                    fontFamily: 'monospace',
                    fontSize: '0.7rem',
                    color: 'var(--text-1)',
                  }}
                >
                  {s.key}
                </kbd>
                <span style={{ color: 'var(--text-2)' }}>{s.desc}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
