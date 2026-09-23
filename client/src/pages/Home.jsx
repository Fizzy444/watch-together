import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActiveRooms } from '../api/index.js';
import { getProfileName } from '../utils/profile.js';
import { getStoredUser } from '../utils/auth.js';
import CreateRoomModal from '../components/CreateRoomModal.jsx';
import ProfileBadge from '../components/ProfileBadge.jsx';
import AuthModal from '../components/AuthModal.jsx';
import {
  PlaySquare,
  Plus,
  Search,
  LogIn,
  Film,
  Radio,
  Loader2,
  ArrowRight,
  Info,
  Zap,
} from 'lucide-react';

export default function Home() {
  const navigate = useNavigate();
  const [activeRooms, setActiveRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  // Auth & Profile state (username is permanent)
  const [currentUser, setCurrentUser] = useState(getStoredUser);
  const [profileName, setProfileName] = useState(() => {
    const user = getStoredUser();
    return user?.username || getProfileName();
  });

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('signin');

  // Search & quick join states
  const [searchQuery, setSearchQuery] = useState('');
  const [directCode, setDirectCode] = useState('');

  // Fetch active rooms list
  const fetchRooms = useCallback(async () => {
    try {
      const data = await getActiveRooms();
      setActiveRooms(data);
    } catch (err) {
      console.error('Failed to fetch rooms:', err);
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 3500);
    return () => clearInterval(interval);
  }, [fetchRooms]);

  // Listen for auth changes
  useEffect(() => {
    const handleAuthChange = (e) => {
      const user = e.detail?.user || null;
      setCurrentUser(user);
      if (user) {
        setProfileName(user.username);
      }
    };
    window.addEventListener('wt-auth-changed', handleAuthChange);
    return () => window.removeEventListener('wt-auth-changed', handleAuthChange);
  }, []);

  function handleAuthSuccess(user) {
    setCurrentUser(user);
    if (user?.username) {
      setProfileName(user.username);
    }
  }

  // Filtered rooms based on search
  const filteredRooms = activeRooms.filter((r) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.movieName && r.movieName.toLowerCase().includes(q)) ||
      (r.hostName && r.hostName.toLowerCase().includes(q)) ||
      r.id.toLowerCase().includes(q)
    );
  });

  function handleOpenCreateModal() {
    setIsModalOpen(true);
  }

  function handleJoinRoom(roomId) {
    navigate(`/watch/${roomId}`);
  }

  function handleDirectJoin(e) {
    e.preventDefault();
    const clean = directCode.trim().toLowerCase();
    if (clean) {
      navigate(`/watch/${clean}`);
    }
  }

  return (
    <div className="container" style={{ paddingBottom: 'var(--sp-12)' }}>
      {/* Top Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--sp-6) 0 var(--sp-8)',
          borderBottom: '1px solid var(--border)',
          marginBottom: 'var(--sp-8)',
          flexWrap: 'wrap',
          gap: 'var(--sp-4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)' }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 'var(--r-md)',
              background: 'linear-gradient(135deg, var(--primary) 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
              cursor: 'pointer',
            }}
            onClick={() => navigate('/')}
          >
            <PlaySquare size={22} color="#fff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
              <h1
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  margin: 0,
                  cursor: 'pointer',
                }}
                onClick={() => navigate('/')}
              >
                Watch Together
              </h1>
              <span
                style={{
                  fontSize: '0.6875rem',
                  padding: '2px 8px',
                  borderRadius: 'var(--r-full)',
                  background: 'rgba(234, 179, 8, 0.12)',
                  color: '#eab308',
                  border: '1px solid rgba(234, 179, 8, 0.25)',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                }}
              >
                <Zap size={10} />
                P2P
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => navigate('/')}
                style={{ fontSize: '0.75rem', color: 'var(--text-3)', padding: '2px 8px' }}
              >
                <Info size={13} style={{ marginRight: 4 }} /> About
              </button>
            </div>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-3)', margin: 0 }}>
              Direct device-to-device synchronized video streaming
            </p>
          </div>
        </div>

        {/* Header Right Actions: Profile / Auth + Create Room */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
          {currentUser ? (
            <ProfileBadge name={currentUser.username} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              {profileName && <ProfileBadge name={profileName} />}
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setAuthModalMode('signin');
                  setAuthModalOpen(true);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <LogIn size={14} />
                Sign In
              </button>
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={() => handleOpenCreateModal()}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}
          >
            <Plus size={16} />
            Create Room
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-8)' }}>
        {/* Quick Search & Join Bar */}
        <section
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--sp-3)',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-card)',
            padding: 'var(--sp-4)',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)',
          }}
        >
          {/* Room Search input */}
          <div style={{ position: 'relative', flex: '1 1 280px' }}>
            <Search
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
              className="input input-sm"
              placeholder="Search active rooms by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 36, width: '100%' }}
            />
          </div>

          {/* Direct Code Join Form */}
          <form
            onSubmit={handleDirectJoin}
            className="home-direct-join-form"
            style={{ display: 'flex', gap: 'var(--sp-2)', flex: '0 0 auto' }}
          >
            <input
              type="text"
              className="input input-sm"
              placeholder="Enter Room Code..."
              value={directCode}
              onChange={(e) => setDirectCode(e.target.value)}
              style={{ width: 160, fontFamily: 'monospace' }}
            />
            <button
              type="submit"
              className="btn btn-secondary btn-sm"
              disabled={!directCode.trim()}
              title="Join private room"
            >
              <LogIn size={14} /> Join
            </button>
          </form>
        </section>

        {/* Section: Active Rooms */}
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 'var(--sp-4)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <Radio size={16} color="var(--success)" />
              <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Active Rooms</h3>
              {!loadingRooms && activeRooms.length > 0 && (
                <span className="badge" style={{ borderColor: 'rgba(34, 197, 94, 0.3)', color: 'var(--success)' }}>
                  {activeRooms.length} live
                </span>
              )}
            </div>

            {searchQuery && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSearchQuery('')}
                style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}
              >
                Clear filter
              </button>
            )}
          </div>

          {loadingRooms ? (
            <div style={{ padding: 'var(--sp-8)', display: 'flex', justifyContent: 'center', color: 'var(--text-3)' }}>
              <Loader2 className="spinner" size={24} />
            </div>
          ) : filteredRooms.length === 0 ? (
            <div
              className="card"
              style={{
                padding: 'var(--sp-10) var(--sp-6)',
                textAlign: 'center',
                color: 'var(--text-2)',
                background: 'var(--bg-card)',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  background: 'rgba(99, 102, 241, 0.1)',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto var(--sp-3)',
                }}
              >
                <Zap size={28} />
              </div>
              <p style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: '1.0625rem', marginBottom: 'var(--sp-1)' }}>
                {searchQuery ? 'No rooms match your search' : 'No active rooms right now'}
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-3)', maxWidth: 440, margin: '0 auto var(--sp-5)' }}>
                Start a private watch party! Choose any local video file from your computer or phone and stream directly to your friends with 0 server uploads.
              </p>
              <button className="btn btn-primary" onClick={() => handleOpenCreateModal()}>
                <Plus size={16} /> Create Watch Room
              </button>
            </div>
          ) : (
            <div className="rooms-grid">
              {filteredRooms.map((r) => (
                <div key={r.id} className="room-card">
                  <div className="room-card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <span className="room-card-title" title={r.name}>
                        {r.name}
                      </span>
                      <span
                        className="badge"
                        style={{
                          background: 'rgba(234, 179, 8, 0.12)',
                          color: '#eab308',
                          border: '1px solid rgba(234, 179, 8, 0.3)',
                          fontSize: '0.625rem',
                          padding: '1px 5px',
                          flexShrink: 0,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Zap size={9} />
                        P2P
                      </span>
                    </div>
                    <span className="status-indicator">
                      {r.usersCount} {r.usersCount === 1 ? 'member' : 'members'}
                    </span>
                  </div>

                  <div className="room-card-movie" title={r.movieName}>
                    <Film size={14} style={{ flexShrink: 0 }} />
                    <span>{r.movieName}</span>
                  </div>

                  <div className="room-card-meta">
                    <span>Host: {r.hostName}</span>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleJoinRoom(r.id)}
                      style={{ padding: '0 var(--sp-3)' }}
                    >
                      Join <ArrowRight size={13} style={{ marginLeft: 4 }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Fast Action Card */}
        <section
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.04) 100%)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: 'var(--r-lg)',
            padding: 'var(--sp-6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 'var(--sp-4)',
          }}
        >
          <div>
            <h4 style={{ margin: '0 0 var(--sp-1) 0', fontSize: '1rem', fontWeight: 600, color: 'var(--text-1)' }}>
              Stream Directly From Your Device
            </h4>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-2)' }}>
              No upload waiting time. Pick any local MP4, MKV, WebM, or MOV file and watch together in real time.
            </p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => handleOpenCreateModal()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Zap size={14} /> Start P2P Broadcast
          </button>
        </section>
      </div>

      {/* Create Room Modal */}
      <CreateRoomModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />

      {/* Auth Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        initialMode={authModalMode}
        onAuthSuccess={handleAuthSuccess}
      />
    </div>
  );
}
