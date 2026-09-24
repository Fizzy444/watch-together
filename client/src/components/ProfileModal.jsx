import { useState, useEffect } from 'react';
import { User, X, Check, LogOut } from 'lucide-react';
import { logoutApi } from '../utils/auth.js';
import { saveProfileName, clearProfileName } from '../utils/profile.js';

export default function ProfileModal({
  isOpen,
  onClose,
  currentName = '',
  onSave,
  isMandatory = false,
}) {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setName(currentName || '');
      setError('');
    }
  }, [isOpen, currentName]);

  // Escape key handler if not mandatory
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isMandatory) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMandatory, onClose]);

  if (!isOpen) return null;

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter a display name');
      return;
    }

    saveProfileName(trimmed);
    onSave?.(trimmed);
    onClose?.();
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!isMandatory) onClose?.();
      }}
    >
      <div
        className="modal-content"
        style={{ maxWidth: 400 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <User size={18} />
            <h3 style={{ fontSize: '1rem', margin: 0 }}>
              {currentName ? 'Edit Profile' : 'Choose Display Name'}
            </h3>
          </div>
          {!isMandatory && (
            <button className="btn-icon" onClick={onClose} title="Close">
              <X size={18} />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ gap: 'var(--sp-3)' }}>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-3)', margin: 0 }}>
              Your display name is shown in rooms and chat. No registration or password required.
            </p>

            {error && (
              <div
                style={{
                  padding: 'var(--sp-2) var(--sp-3)',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--error)',
                  borderRadius: 'var(--r-md)',
                  color: 'var(--error)',
                  fontSize: '0.75rem',
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-2)' }}>
                Display Name
              </label>
              <input
                type="text"
                className="input"
                placeholder="Enter your name..."
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError('');
                }}
                autoFocus
                maxLength={32}
              />
            </div>
          </div>

          <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {currentName && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  try { await logoutApi(); } catch {}
                  clearProfileName();
                  window.dispatchEvent(new CustomEvent("wt-auth-changed", { detail: { user: null, token: null } }));
                  onClose?.();
                }}
                style={{ color: "var(--error)", display: "inline-flex", alignItems: "center", gap: 6 }}
                title="Sign out of your profile"
              >
                <LogOut size={14} />
                Sign Out
              </button>
            )}
            <div style={{ display: "flex", gap: "var(--sp-2)", marginLeft: "auto" }}>
              {!isMandatory && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={!name.trim()}
                style={{ minWidth: 100 }}
              >
                <Check size={14} style={{ marginRight: 4 }} />
                {currentName ? "Save" : "Continue"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
