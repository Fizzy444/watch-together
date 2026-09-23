import { useState, useEffect } from 'react';
import { User, Lock, Eye, EyeOff, Loader2, AlertCircle, LogIn, UserPlus, X } from 'lucide-react';
import { loginApi, signupApi } from '../utils/auth.js';

export default function AuthModal({
  isOpen,
  onClose,
  initialMode = 'signin', // 'signin' | 'signup'
  onSuccess,
}) {
  const [mode, setMode] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode || 'signin');
      setUsername('');
      setPassword('');
      setError('');
      setShowPassword(false);
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !loading) {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, loading, onClose]);

  if (!isOpen) return null;

  async function handleSubmit(e) {
    e.preventDefault();
    const cleanUser = username.trim();
    if (!cleanUser) {
      setError('Please enter a username');
      return;
    }
    if (!password) {
      setError('Please enter a password');
      return;
    }
    if (cleanUser.length < 3) {
      setError('Username must be at least 3 characters');
      return;
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let result;
      if (mode === 'signup') {
        result = await signupApi(cleanUser, password);
      } else {
        result = await loginApi(cleanUser, password);
      }
      onSuccess?.(result.user);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!loading) onClose?.();
      }}
    >
      <div
        className="modal-content"
        style={{
          maxWidth: 420,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-hover)',
          borderRadius: 'var(--r-lg)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.05)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
              {mode === 'signup' ? 'Create Account' : 'Welcome Back'}
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-3)', margin: '4px 0 0 0' }}>
              {mode === 'signup'
                ? 'Sign up with just a username & password. No email needed.'
                : 'Sign in to access your media library and rooms.'}
            </p>
          </div>
          <button
            className="btn-icon"
            onClick={onClose}
            disabled={loading}
            title="Close"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            background: 'var(--bg)',
            padding: 4,
            borderRadius: 'var(--r-md)',
            margin: 'var(--sp-4) var(--sp-6) 0',
            gap: 4,
            border: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              padding: '7px 12px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              borderRadius: 'var(--r-sm)',
              background: mode === 'signin' ? 'var(--bg-elevated)' : 'transparent',
              color: mode === 'signin' ? 'var(--text-1)' : 'var(--text-3)',
              border: mode === 'signin' ? '1px solid var(--border)' : '1px solid transparent',
              boxShadow: mode === 'signin' ? '0 1px 3px rgba(0,0,0,0.5)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onClick={() => {
              setMode('signin');
              setError('');
            }}
          >
            <LogIn size={14} />
            Sign In
          </button>
          <button
            type="button"
            className="btn"
            style={{
              flex: 1,
              padding: '7px 12px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              borderRadius: 'var(--r-sm)',
              background: mode === 'signup' ? 'var(--bg-elevated)' : 'transparent',
              color: mode === 'signup' ? 'var(--text-1)' : 'var(--text-3)',
              border: mode === 'signup' ? '1px solid var(--border)' : '1px solid transparent',
              boxShadow: mode === 'signup' ? '0 1px 3px rgba(0,0,0,0.5)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
            onClick={() => {
              setMode('signup');
              setError('');
            }}
          >
            <UserPlus size={14} />
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
            {error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-2)',
                  padding: 'var(--sp-3)',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: 'var(--r-sm)',
                  color: '#ef4444',
                  fontSize: '0.8125rem',
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {/* Username Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-2)' }}>
                Username
              </label>
              <div style={{ position: 'relative' }}>
                <User
                  size={16}
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-3)',
                  }}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="e.g. Alex, MovieFan22"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    if (error) setError('');
                  }}
                  autoFocus
                  maxLength={30}
                  disabled={loading}
                  style={{ paddingLeft: 38, width: '100%' }}
                />
              </div>
            </div>

            {/* Password Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-2)' }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <Lock
                  size={16}
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-3)',
                  }}
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  placeholder="Enter your password..."
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError('');
                  }}
                  maxLength={100}
                  disabled={loading}
                  style={{ paddingLeft: 38, paddingRight: 38, width: '100%' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-3)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {mode === 'signup' && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-3)', margin: 0, lineHeight: 1.4 }}>
                💡 Tip: There are no email resets or verification codes. Pick a username and password you will remember.
              </p>
            )}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={loading || !username.trim() || !password}
              style={{ minWidth: 120 }}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="spin" style={{ marginRight: 6 }} />
                  {mode === 'signup' ? 'Creating...' : 'Signing In...'}
                </>
              ) : mode === 'signup' ? (
                'Create Account'
              ) : (
                'Sign In'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
