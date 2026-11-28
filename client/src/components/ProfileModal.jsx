import { useState, useEffect } from 'react';
import { User, X, Check } from 'lucide-react';
import { saveProfileName } from '../utils/profile.js';

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
      setError('Please enter a username');
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
              {currentName ? 'Edit Username' : 'Choose Username'}
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
              Your username is shown in rooms and chat.
            </p>

            {error && (
              <div className="modal-alert modal-alert-error">
                {error}
              </div>
            )}

            <div className="field-group">
              <label htmlFor="profile-username-input" className="field-label">
                Username
              </label>
              <input
                id="profile-username-input"
                type="text"
                className="input"
                placeholder="Enter your username..."
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

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
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
              {currentName ? 'Save' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
