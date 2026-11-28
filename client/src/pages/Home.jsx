import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActiveRooms } from '../api/index.js';
import { getProfileName } from '../utils/profile.js';
import ProfileBadge from '../components/ProfileBadge.jsx';
import {
  PlaySquare,
  Plus,
  Search,
  User,
  Film,
  Radio,
  Loader2,
  Globe,
  Zap,
} from 'lucide-react';

const CreateRoomModal = lazy(() => import('../components/CreateRoomModal.jsx'));
const ProfileModal = lazy(() => import('../components/ProfileModal.jsx'));

const STREAM_TYPE_META = {
  tunnel: { label: 'Tunnel', className: 'badge badge-info', Icon: Globe },
  torrent: { label: 'Torrent', className: 'badge badge-host', Icon: Radio },
  p2p: { label: 'P2P', className: 'badge badge-warning', Icon: Zap },
};

export default function Home() {
  const navigate = useNavigate();
  const [activeRooms, setActiveRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  const [profileName, setProfileName] = useState(getProfileName);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [directCode, setDirectCode] = useState('');

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
    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchRooms();
      }
    }, 4000);
    const onVisibilityChange = () => {
      if (!document.hidden) {
        fetchRooms();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchRooms]);

  const filteredRooms = activeRooms.filter((r) => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return true;
    return (
      (r.name && r.name.toLowerCase().includes(query)) ||
      (r.movieName && r.movieName.toLowerCase().includes(query)) ||
      (r.hostName && r.hostName.toLowerCase().includes(query)) ||
      r.id.toLowerCase().includes(query)
    );
  });

  function handleJoinRoom(roomId) {
    navigate(`/watch/${roomId}`, { state: { fromDashboard: Boolean(profileName) } });
  }

  function handleDirectJoin(e) {
    e.preventDefault();
    const clean = directCode.trim().toLowerCase();
    if (clean) {
      navigate(`/watch/${clean}`, { state: { fromDashboard: Boolean(profileName) } });
    }
  }

  return (
    <div className="container home-page">
      <header className="home-header">
        <div className="home-brand">
          <div className="home-brand-icon">
            <PlaySquare size={20} color="#fff" />
          </div>
          <div>
            <h1 className="home-brand-title">Watch Together</h1>
            <p className="home-brand-subtitle">Synchronized local, tunnel, and P2P playback</p>
          </div>
        </div>

        <div className="home-header-actions">
          {profileName ? (
            <ProfileBadge
              name={profileName}
              onEdit={() => setIsProfileModalOpen(true)}
              onClear={() => setProfileName('')}
            />
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setIsProfileModalOpen(true)}
            >
              <User size={14} />
              <span>Set Username</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setIsModalOpen(true)}
          >
            <Plus size={16} />
            <span>Create Room</span>
          </button>
        </div>
      </header>

      <main className="home-stack">
        <section className="home-search-bar" aria-label="Find or join a room">
          <div className="home-search-field">
            <Search size={16} className="home-search-icon" />
            <input
              type="text"
              className="input input-sm"
              placeholder="Search active rooms..."
              aria-label="Search active rooms"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 36 }}
            />
          </div>

          <form onSubmit={handleDirectJoin} className="home-direct-join-form">
            <input
              type="text"
              className="input input-sm"
              placeholder="Room code"
              aria-label="Room code"
              value={directCode}
              onChange={(e) => setDirectCode(e.target.value)}
              style={{ width: 150, fontFamily: 'monospace' }}
            />
            <button
              type="submit"
              className="btn btn-secondary btn-sm"
              disabled={!directCode.trim()}
              title="Join room by code"
            >
              Join
            </button>
          </form>
        </section>

        <section>
          <div className="home-section-header">
            <div className="home-section-title">
              <Radio size={16} color="var(--success)" />
              <h2>Active Rooms</h2>
              {!loadingRooms && activeRooms.length > 0 && (
                <span className="badge badge-success">{activeRooms.length} live</span>
              )}
            </div>

            {searchQuery && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSearchQuery('')}
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
            <div className="card home-empty-state">
              <div className="home-empty-icon">
                <Film size={22} />
              </div>
              <p style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: '1rem' }}>
                {searchQuery ? 'No rooms match your search' : 'No active rooms'}
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-3)', maxWidth: 400 }}>
                Create a room to stream a video file or magnet link in sync with others.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setIsModalOpen(true)}
              >
                <Plus size={16} />
                <span>Create Room</span>
              </button>
            </div>
          ) : (
            <div className="rooms-grid">
              {filteredRooms.map((r) => {
                const typeKey = r.streamType === 'tunnel' ? 'tunnel' : r.streamType === 'torrent' ? 'torrent' : 'p2p';
                const meta = STREAM_TYPE_META[typeKey];
                const TypeIcon = meta.Icon;

                return (
                  <div key={r.id} className="room-card">
                    <div className="room-card-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <span className="room-card-title" title={r.name}>
                          {r.name}
                        </span>
                        <span className={`${meta.className} badge-compact`} style={{ flexShrink: 0 }}>
                          <TypeIcon size={9} />
                          <span>{meta.label}</span>
                        </span>
                      </div>
                      <span
                        className="status-indicator"
                        style={r.usersCount === 0 ? { color: 'var(--warning)' } : undefined}
                      >
                        {r.usersCount === 0
                          ? 'Empty'
                          : `${r.usersCount} ${r.usersCount === 1 ? 'member' : 'members'}`}
                      </span>
                    </div>

                    <div className="room-card-movie" title={r.movieName}>
                      <Film size={14} style={{ flexShrink: 0 }} />
                      <span>{r.movieName}</span>
                    </div>

                    <div className="room-card-meta">
                      <span>Host: {r.hostName}</span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleJoinRoom(r.id)}
                      >
                        Join
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <Suspense fallback={null}>
        {isModalOpen && (
          <CreateRoomModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
        )}
        {isProfileModalOpen && (
          <ProfileModal
            isOpen={isProfileModalOpen}
            onClose={() => setIsProfileModalOpen(false)}
            currentName={profileName}
            onSave={(newName) => setProfileName(newName)}
          />
        )}
      </Suspense>
    </div>
  );
}
