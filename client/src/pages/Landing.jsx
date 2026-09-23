import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PlaySquare,
  Film,
  Zap,
  Clock,
  ShieldCheck,
  FolderHeart,
  ArrowRight,
  LogIn,
  UserPlus,
  Radio,
  Tv,
  Users,
  MessageSquare,
  Sparkles,
  ChevronRight,
  Play,
  CheckCircle2,
} from 'lucide-react';
import { getStoredUser } from '../utils/auth.js';
import AuthModal from '../components/AuthModal.jsx';

export default function Landing() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(getStoredUser);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('signin');
  const [roomCodeInput, setRoomCodeInput] = useState('');

  // Listen for auth changes across tabs/components
  useEffect(() => {
    const handleAuthChange = (e) => {
      setCurrentUser(e.detail?.user || null);
    };
    window.addEventListener('wt-auth-changed', handleAuthChange);
    return () => window.removeEventListener('wt-auth-changed', handleAuthChange);
  }, []);

  function handleOpenAuth(mode) {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  }

  function handleAuthSuccess(user) {
    setCurrentUser(user);
    navigate('/dashboard');
  }

  function handleJoinRoom(e) {
    e.preventDefault();
    const clean = roomCodeInput.trim().toLowerCase();
    if (clean) {
      navigate(`/watch/${clean}`);
    }
  }

  return (
    <div className="landing-page" style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-1)' }}>
      {/* Top Navbar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--sp-4) var(--sp-6)',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(15, 17, 23, 0.85)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', cursor: 'pointer' }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--r-md)',
              background: 'linear-gradient(135deg, var(--primary) 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 16px rgba(99, 102, 241, 0.35)',
            }}
          >
            <PlaySquare size={20} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: '1.125rem', letterSpacing: '-0.02em' }}>
                WatchTogether
              </span>
              <span
                style={{
                  fontSize: '0.6875rem',
                  padding: '2px 6px',
                  borderRadius: 'var(--r-full)',
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: 'var(--primary)',
                  fontWeight: 600,
                }}
              >
                v1.2
              </span>
            </div>
          </div>
        </div>

        {/* Navigation links & User Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <a
            href="#features"
            style={{
              color: 'var(--text-2)',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
              padding: '6px 12px',
            }}
            className="landing-nav-link"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            style={{
              color: 'var(--text-2)',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
              padding: '6px 12px',
            }}
            className="landing-nav-link"
          >
            How It Works
          </a>

          {currentUser ? (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/dashboard')}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Tv size={15} />
              Dashboard ({currentUser.username})
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => handleOpenAuth('signin')}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <LogIn size={15} />
                Sign In
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleOpenAuth('signup')}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <UserPlus size={15} />
                Sign Up
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: 'var(--sp-12) var(--sp-6) var(--sp-10)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        {/* Glow backdrop */}
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '600px',
            height: '240px',
            background: 'radial-gradient(circle, rgba(99, 102, 241, 0.12) 0%, rgba(168, 85, 247, 0.05) 50%, transparent 70%)',
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />

        {/* Feature badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 14px',
            borderRadius: 'var(--r-full)',
            background: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            fontSize: '0.8125rem',
            color: 'var(--primary)',
            fontWeight: 500,
            marginBottom: 'var(--sp-4)',
            zIndex: 1,
          }}
        >
          <Sparkles size={14} />
          <span>Private, Frame-Accurate Video Synchronization</span>
        </div>

        {/* Headline */}
        <h1
          style={{
            fontSize: 'clamp(2.25rem, 5vw, 3.5rem)',
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            margin: '0 0 var(--sp-4) 0',
            maxWidth: 820,
            zIndex: 1,
          }}
        >
          Watch Movies Together,{' '}
          <span
            style={{
              background: 'linear-gradient(135deg, #818cf8 0%, #c084fc 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Synchronized to the Millisecond.
          </span>
        </h1>

        {/* Subtitle */}
        <p
          style={{
            fontSize: '1.0625rem',
            color: 'var(--text-2)',
            maxWidth: 680,
            lineHeight: 1.6,
            margin: '0 0 var(--sp-8) 0',
            zIndex: 1,
          }}
        >
          Host private watch rooms with your friends and family. Stream directly from your own media library with ultra-low latency, smart pause catch-up, and real-time chat — zero email, phone, or third-party signups required.
        </p>

        {/* Hero CTAs */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--sp-4)',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: 'var(--sp-8)',
            zIndex: 1,
          }}
        >
          {currentUser ? (
            <button
              className="btn btn-primary"
              style={{
                fontSize: '1rem',
                padding: '12px 28px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)',
              }}
              onClick={() => navigate('/dashboard')}
            >
              <Tv size={18} />
              Open Media Dashboard
              <ArrowRight size={16} />
            </button>
          ) : (
            <>
              <button
                className="btn btn-primary"
                style={{
                  fontSize: '1rem',
                  padding: '12px 28px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: '0 4px 20px rgba(99, 102, 241, 0.4)',
                }}
                onClick={() => handleOpenAuth('signup')}
              >
                <UserPlus size={18} />
                Get Started — It's Free
                <ArrowRight size={16} />
              </button>
              <button
                className="btn btn-secondary"
                style={{
                  fontSize: '1rem',
                  padding: '12px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
                onClick={() => handleOpenAuth('signin')}
              >
                <LogIn size={18} />
                Sign In
              </button>
            </>
          )}
        </div>

        {/* Quick Join With Room Code */}
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 'var(--sp-4) var(--sp-6)',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 'var(--sp-3)',
            maxWidth: 520,
            width: '100%',
            justifyContent: 'center',
            boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
            zIndex: 1,
          }}
        >
          <span style={{ fontSize: '0.875rem', color: 'var(--text-3)', fontWeight: 500 }}>
            Have a room code?
          </span>
          <form
            onSubmit={handleJoinRoom}
            style={{ display: 'flex', gap: 'var(--sp-2)', flex: '1 1 240px' }}
          >
            <input
              type="text"
              className="input input-sm"
              placeholder="e.g. crimson-falcon"
              value={roomCodeInput}
              onChange={(e) => setRoomCodeInput(e.target.value)}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.875rem' }}
            />
            <button
              type="submit"
              className="btn btn-secondary btn-sm"
              disabled={!roomCodeInput.trim()}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              Join Room
              <ChevronRight size={14} />
            </button>
          </form>
        </div>

        {/* Sleek Live Preview Mockup Card */}
        <div
          style={{
            marginTop: 'var(--sp-12)',
            width: '100%',
            maxWidth: 880,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-xl)',
            overflow: 'hidden',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(99, 102, 241, 0.1)',
            zIndex: 1,
          }}
        >
          {/* Mock Browser/Player Chrome Header */}
          <div
            style={{
              padding: '10px 16px',
              background: 'var(--bg-surface)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#eab308' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginLeft: 8, fontFamily: 'monospace' }}>
                room: friday-night-movie
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: '0.6875rem',
                  padding: '2px 8px',
                  borderRadius: 'var(--r-full)',
                  background: 'rgba(34, 197, 94, 0.15)',
                  color: '#4ade80',
                  fontWeight: 600,
                }}
              >
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} />
                Synchronized (0ms offset)
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--text-2)' }}>
                <Users size={13} />
                <span>4 online</span>
              </div>
            </div>
          </div>

          {/* Mock Player Body */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) 260px',
              background: '#090a0f',
              minHeight: 280,
            }}
            className="landing-mock-grid"
          >
            {/* Simulated Video Canvas */}
            <div
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(180deg, #12151e 0%, #0c0e14 100%)',
                padding: 'var(--sp-8)',
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: '50%',
                  background: 'rgba(99, 102, 241, 0.25)',
                  border: '1px solid rgba(99, 102, 241, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  boxShadow: '0 0 24px rgba(99, 102, 241, 0.5)',
                }}
              >
                <Play size={28} style={{ marginLeft: 4 }} />
              </div>

              {/* Bottom Playback Bar Overlay */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: '12px 16px',
                  background: 'linear-gradient(0deg, rgba(0,0,0,0.85) 0%, transparent 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: '0.75rem', color: 'var(--text-2)', fontFamily: 'monospace' }}>
                  42:15 / 1:43:08
                </span>
                <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: '41%', height: '100%', background: 'var(--primary)' }} />
                </div>
                <span
                  style={{
                    fontSize: '0.6875rem',
                    background: 'var(--bg-elevated)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    color: 'var(--text-2)',
                  }}
                >
                  1080p
                </span>
              </div>
            </div>

            {/* Simulated Live Chat */}
            <div
              style={{
                borderLeft: '1px solid var(--border)',
                background: 'var(--bg-surface)',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                fontSize: '0.75rem',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Room Activity
                </div>
                <div>
                  <span style={{ fontWeight: 600, color: 'var(--primary)' }}>Host:</span>{' '}
                  <span style={{ color: 'var(--text-2)' }}>Popcorn ready! Starting movie 🍿</span>
                </div>
                <div>
                  <span style={{ fontWeight: 600, color: '#38bdf8' }}>Maya:</span>{' '}
                  <span style={{ color: 'var(--text-2)' }}>Audio is super crisp here!</span>
                </div>
                <div>
                  <span style={{ fontWeight: 600, color: '#fb923c' }}>Leo:</span>{' '}
                  <span style={{ color: 'var(--text-2)' }}>Soundtrack in this scene is amazing 🎶</span>
                </div>
              </div>
              <div
                style={{
                  padding: '6px 10px',
                  background: 'var(--bg-elevated)',
                  borderRadius: 'var(--r-sm)',
                  color: 'var(--text-3)',
                  border: '1px solid var(--border)',
                  marginTop: 12,
                }}
              >
                Send a message...
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Highlights Grid */}
      <section
        id="features"
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: 'var(--sp-12) var(--sp-6)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 'var(--sp-10)' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 var(--sp-3) 0' }}>
            Built for Real Watch Parties
          </h2>
          <p style={{ color: 'var(--text-2)', maxWidth: 580, margin: '0 auto', fontSize: '0.9375rem' }}>
            Everything you need for seamless synchronized viewing without buffering conflicts or complicated setups.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: 'var(--sp-6)',
          }}
        >
          {/* Card 1 */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 'var(--sp-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sp-3)',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 'var(--r-md)',
                background: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Zap size={22} />
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
              Millisecond Sync
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              WebSocket heartbeats continually coordinate video timestamps. Play, pause, and seek actions replicate across all connected viewers instantly.
            </p>
          </div>

          {/* Card 2 */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 'var(--sp-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sp-3)',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 'var(--r-md)',
                background: 'rgba(234, 179, 8, 0.15)',
                color: '#eab308',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Clock size={22} />
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
              Smart Catch-Up Pause
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              If a viewer experiences network lag and is trailing behind when the host pauses, playback smoothly completes to the pause mark instead of jarringly cutting the scene.
            </p>
          </div>

          {/* Card 4 */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 'var(--sp-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--sp-3)',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 'var(--r-md)',
                background: 'rgba(34, 197, 94, 0.15)',
                color: '#22c55e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShieldCheck size={22} />
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
              Zero-Friction Access
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              No email addresses. No phone verifications. No trackers. Create an account with just a username and password, or join any room with a 6-character room code.
            </p>
          </div>
        </div>
      </section>

      {/* "How It Works" Section */}
      <section
        id="how-it-works"
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: 'var(--sp-12) var(--sp-6)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 'var(--sp-10)' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 var(--sp-3) 0' }}>
            How It Works in 3 Steps
          </h2>
          <p style={{ color: 'var(--text-2)', maxWidth: 540, margin: '0 auto', fontSize: '0.9375rem' }}>
            Getting your private watch party running takes less than 60 seconds.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 'var(--sp-6)',
          }}
        >
          {/* Step 1 */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 'var(--sp-6)',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--r-full)',
                background: 'var(--primary)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 'var(--sp-4)',
              }}
            >
              1
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 var(--sp-2) 0' }}>
              Choose or Upload Media
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              Pick movies from the pre-indexed media library or upload video files (.mp4, .mkv, .webm) directly. Thumbnails and metadata are generated automatically.
            </p>
          </div>

          {/* Step 2 */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 'var(--sp-6)',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--r-full)',
                background: 'var(--primary)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 'var(--sp-4)',
              }}
            >
              2
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 var(--sp-2) 0' }}>
              Spin Up a Private Room
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              Create a room with your chosen movie title. Send the unique room code or direct shareable URL to your friends on desktop, tablet, or phone.
            </p>
          </div>

          {/* Step 3 */}
          <div
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              padding: 'var(--sp-6)',
              position: 'relative',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--r-full)',
                background: 'var(--primary)',
                color: '#fff',
                fontWeight: 700,
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 'var(--sp-4)',
              }}
            >
              3
            </div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 var(--sp-2) 0' }}>
              Watch Together in Real-Time
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.6, margin: 0 }}>
              Sit back and enjoy the show! The host holds playback controls while everyone chats in real time. Reloading the page maintains your host session seamlessly.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section
        style={{
          maxWidth: 1100,
          margin: '0 auto',
          padding: 'var(--sp-12) var(--sp-6) var(--sp-16)',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.1) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: 'var(--r-xl)',
            padding: 'var(--sp-10) var(--sp-8)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--sp-4)',
          }}
        >
          <h2 style={{ fontSize: '1.875rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
            Ready to start watching?
          </h2>
          <p style={{ color: 'var(--text-2)', maxWidth: 520, margin: 0, fontSize: '0.9375rem' }}>
            Sign in with your username or jump straight into the dashboard to start streaming.
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
            {currentUser ? (
              <button
                className="btn btn-primary"
                style={{ padding: '12px 28px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={() => navigate('/dashboard')}
              >
                <Tv size={18} />
                Go to Dashboard
                <ArrowRight size={16} />
              </button>
            ) : (
              <>
                <button
                  className="btn btn-primary"
                  style={{ padding: '12px 28px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={() => handleOpenAuth('signup')}
                >
                  <UserPlus size={18} />
                  Create Free Account
                  <ArrowRight size={16} />
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '12px 24px', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={() => handleOpenAuth('signin')}
                >
                  <LogIn size={18} />
                  Sign In
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: 'var(--sp-8) var(--sp-6)',
          background: 'var(--bg-surface)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--sp-3)',
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <PlaySquare size={18} color="var(--primary)" />
          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>WatchTogether</span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-3)', margin: 0 }}>
          Private synchronized video streaming • Native HTTP 206 streaming • WebSocket powered
        </p>
        <div style={{ display: 'flex', gap: 'var(--sp-4)', fontSize: '0.75rem', color: 'var(--text-3)' }}>
          <span>No cookies or ad tracking</span>
          <span>•</span>
          <span>Username &amp; password auth</span>
          <span>•</span>
          <span>Local network accessible</span>
        </div>
      </footer>

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />
    </div>
  );
}
