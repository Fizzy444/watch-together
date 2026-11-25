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
        aria-expanded={open}
      >
        <div className="profile-badge-avatar">
          {name ? initial : <User size={12} />}
        </div>
        <span className="profile-badge-name">{name || 'Anonymous'}</span>
        <ChevronDown
          size={13}
          style={{
            color: 'var(--text-3)',
            transition: 'transform var(--t-fast)',
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      </button>

      {open && (
        <div className="profile-dropdown">
          <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="profile-badge-avatar" style={{ width: 28, height: 28, fontSize: '0.8125rem' }}>
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
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-3)' }}>Username</div>
            </div>
          </div>

          <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />

          <button type="button" className="profile-dropdown-item" onClick={handleEditClick}>
            <Edit2 size={13} color="var(--text-2)" />
            <span>Change Username</span>
          </button>

          <button type="button" className="profile-dropdown-item danger" onClick={handleClearClick}>
            <Trash2 size={13} />
            <span>Clear Username</span>
          </button>
        </div>
      )}
    </div>
  );
}
