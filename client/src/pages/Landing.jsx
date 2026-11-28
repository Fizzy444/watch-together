import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PlaySquare, Tv } from 'lucide-react';

export default function Landing() {
  const navigate = useNavigate();
  const [roomCodeInput, setRoomCodeInput] = useState('');

  function handleJoinRoom(e) {
    e.preventDefault();
    const clean = roomCodeInput.trim().toLowerCase();
    if (clean) {
      navigate(`/watch/${clean}`);
    }
  }

  return (
    <div className="landing-shell">
      <header className="landing-topbar">
        <div className="home-brand">
          <div className="home-brand-icon">
            <PlaySquare size={20} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: '1.0625rem', letterSpacing: '-0.02em' }}>
            Watch Together
          </span>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => navigate('/dashboard')}
        >
          Dashboard
        </button>
      </header>

      <main className="landing-main">
        <div className="landing-hero-box">
          <h1 style={{ fontSize: 'clamp(1.875rem, 4vw, 2.5rem)', fontWeight: 700 }}>
            Watch video files together in sync
          </h1>
          <p style={{ fontSize: '0.9375rem', color: 'var(--text-2)' }}>
            Stream local media over a Cloudflare tunnel, WebRTC peer connection, or BitTorrent
            magnet link with synchronized playback controls, room chat, and voice.
          </p>

          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => navigate('/dashboard')}
          >
            <Tv size={18} />
            <span>Open Dashboard</span>
          </button>

          <div className="landing-join-card">
            <label htmlFor="landing-room-code" className="field-label">
              Join an existing room by code
            </label>
            <form onSubmit={handleJoinRoom} style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <input
                id="landing-room-code"
                type="text"
                className="input input-sm"
                placeholder="Enter room code"
                value={roomCodeInput}
                onChange={(e) => setRoomCodeInput(e.target.value)}
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
              <button
                type="submit"
                className="btn btn-secondary btn-sm"
                disabled={!roomCodeInput.trim()}
              >
                Join
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
