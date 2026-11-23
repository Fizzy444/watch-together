import { useState, useRef, useEffect } from 'react';
import { User, ChevronDown, Edit2, Trash2 } from 'lucide-react';
import { clearProfileName } from '../utils/profile.js';

export default function ProfileBadge({ name, onEdit, onClear }) {
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

  function handleEditClick(e) {
    e.stopPropagation();
    setOpen(false);
    onEdit?.();
  }

  function handleClearClick(e) {
    e.stopPropagation();
    clearProfileName();
    setOpen(false);
    onClear?.();
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="profile-badge-btn"
        onClick={() => setOpen((prev) => !prev)}
        title={name ? `Username: ${name}` : 'Guest'}
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
            minWidth: 180,
            background: 'var(--bg-card, #18181b)',
            border: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
            borderRadius: 'var(--r-md, 10px)',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.05)',
            backdropFilter: 'blur(16px)',
            padding: '6px',
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
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
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'var(--primary, #e5484d)',
                color: '#fff',
                fontSize: '0.8125rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {name ? initial : <User size={14} />}
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
                  fontSize: '0.6875rem',
                  color: 'var(--text-3)',
                }}
              >
                Current Username
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border, rgba(255, 255, 255, 0.08))', margin: '4px 0' }} />

          <button
            type="button"
            onClick={handleEditClick}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--text-1)',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--r-sm, 6px)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            <Edit2 size={13} color="var(--text-2)" />
            <span>Change Username</span>
          </button>

          <button
            type="button"
            onClick={handleClearClick}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--text-3)',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--r-sm, 6px)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
              e.currentTarget.style.color = 'var(--error)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-3)';
            }}
          >
            <Trash2 size={13} />
            <span>Clear Username</span>
          </button>
        </div>
      )}
    </div>
  );
}
