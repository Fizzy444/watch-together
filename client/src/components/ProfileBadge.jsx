import { useState, useRef, useEffect } from 'react';
import { User, LogOut, ChevronDown } from 'lucide-react';
import { logoutApi } from '../utils/auth.js';
import { clearProfileName } from '../utils/profile.js';

export default function ProfileBadge({ name, onSignOut }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const initial = name ? name[0].toUpperCase() : '?';

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleSignOut(e) {
    e.stopPropagation();
    try {
      await logoutApi();
    } catch (err) {
      console.warn('Error during logout:', err);
    }
    clearProfileName();
    window.dispatchEvent(new CustomEvent('wt-auth-changed', { detail: { user: null, token: null } }));
    setOpen(false);
    onSignOut?.();
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="profile-badge-btn"
        onClick={() => setOpen((prev) => !prev)}
        title={name ? `Signed in as ${name} (Click to open menu)` : 'Guest'}
        style={{
          cursor: 'pointer',
          userSelect: 'none',
          outline: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <div className="profile-badge-avatar">
          {name ? initial : <User size={12} />}
        </div>
        <span className="profile-badge-name">
          {name || 'Anonymous'}
        </span>
        <ChevronDown
          size={13}
          style={{
            color: 'var(--text-3)',
            transition: 'transform 0.2s ease',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 1000,
            minWidth: 200,
            background: 'var(--bg-card, #18181b)',
            border: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
            borderRadius: 'var(--r-md, 10px)',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.05)',
            backdropFilter: 'blur(16px)',
            padding: '6px',
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          {/* User Info Header */}
          <div
            style={{
              padding: '8px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--primary, #3b82f6)',
                color: '#fff',
                fontSize: '0.8125rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {name ? initial : <User size={15} />}
            </div>
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  color: 'var(--text-1)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {name || 'Guest'}
              </div>
              <div
                style={{
                  fontSize: '0.71875rem',
                  color: 'var(--success, #10b981)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  marginTop: '1px',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                <span>Active Profile</span>
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border, rgba(255, 255, 255, 0.08))', margin: '4px 0' }} />

          {/* Sign Out Button */}
          <button
            type="button"
            onClick={handleSignOut}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--error, #ef4444)',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--r-sm, 6px)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      )}
    </div>
  );
}
