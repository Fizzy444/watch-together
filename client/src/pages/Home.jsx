import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMovies, getActiveRooms } from '../api/index.js';
import { getProfileName, saveProfileName } from '../utils/profile.js';
import MovieCard from '../components/MovieCard.jsx';
import UploadZone from '../components/UploadZone.jsx';
import CreateRoomModal from '../components/CreateRoomModal.jsx';
import ProfileBadge from '../components/ProfileBadge.jsx';
import ProfileModal from '../components/ProfileModal.jsx';
import {
  PlaySquare,
  Plus,
  Search,
  LogIn,
  Film,
  Radio,
  Loader2,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';

export default function Home() {
  const navigate = useNavigate();
  const [movies, setMovies] = useState([]);
  const [activeRooms, setActiveRooms] = useState([]);
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [error, setError] = useState('');

  // Profile state
  const [profileName, setProfileName] = useState(getProfileName);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Search & Direct Join state
  const [searchQuery, setSearchQuery] = useState('');
  const [directCode, setDirectCode] = useState('');

  // Create Room modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [preselectedMovie, setPreselectedMovie] = useState(null);

  const fetchMoviesList = useCallback(async () => {
    try {
      const data = await getMovies();
      setMovies(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMovies(false);
    }
  }, []);

  const fetchRoomsList = useCallback(async () => {
    try {
      const data = await getActiveRooms();
      setActiveRooms(data);
    } catch {
      // Non-blocking error for rooms list
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  useEffect(() => {
    fetchMoviesList();
    fetchRoomsList();
    const interval = setInterval(fetchRoomsList, 6000);
    return () => clearInterval(interval);
  }, [fetchMoviesList, fetchRoomsList]);

  function handleOpenCreateModal(movie = null) {
    if (!profileName) {
      setIsProfileModalOpen(true);
      return;
    }
    setPreselectedMovie(movie);
    setIsModalOpen(true);
  }

  function handleDirectJoin(e) {
    e.preventDefault();
    const code = directCode.trim();
    if (!code) return;
    if (!profileName) {
      setIsProfileModalOpen(true);
      return;
    }
    navigate(`/watch/${code}`);
  }

  function handleJoinRoom(roomId) {
    if (!profileName) {
      setIsProfileModalOpen(true);
      return;
    }
    navigate(`/watch/${roomId}`);
  }

  function handleProfileSave(newName) {
    saveProfileName(newName);
    setProfileName(newName);
  }

  // Filtered rooms based on search
  const filteredRooms = activeRooms.filter((r) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.movieName && r.movieName.toLowerCase().includes(q)) ||
      (r.id && r.id.toLowerCase().includes(q)) ||
      (r.hostName && r.hostName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="container" style={{ paddingBottom: 'var(--sp-12)' }}>
      {/* Top Header Bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 'var(--sp-4)',
          marginBottom: 'var(--sp-8)',
          paddingBottom: 'var(--sp-4)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <div
            style={{
              width: 44,
              height: 44,
              background: 'var(--primary)',
              color: 'var(--primary-text)',
              borderRadius: 'var(--r-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PlaySquare size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Watch Together</h1>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-3)', margin: 0 }}>
              Private synchronized video streaming
            </p>
          </div>
        </div>

        {/* Header Right Actions: Profile Badge + Create Room */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <ProfileBadge
            name={profileName}
            onEdit={() => setIsProfileModalOpen(true)}
          />

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

      {/* Main Content Grid */}
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
              placeholder="Search active rooms by name or movie..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 36, width: '100%' }}
            />
          </div>

          {/* Direct Code Join Form */}
          <form
            onSubmit={handleDirectJoin}
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
              <LogIn size={14} />
              Join
            </button>
          </form>
        </section>

        {/* Section 1: Active Rooms Directory */}
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
                padding: 'var(--sp-8)',
                textAlign: 'center',
                color: 'var(--text-2)',
                background: 'var(--bg-card)',
              }}
            >
              <Radio size={32} style={{ margin: '0 auto var(--sp-2)', opacity: 0.3 }} />
              <p style={{ fontWeight: 500, color: 'var(--text-1)', marginBottom: 'var(--sp-1)' }}>
                {searchQuery ? 'No rooms match your search' : 'No active rooms right now'}
              </p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-3)', marginBottom: 'var(--sp-4)' }}>
                {searchQuery
                  ? 'Try searching with a different term or clear the filter.'
                  : 'Start a watch session and invite your friends with a private link.'}
              </p>
              <button className="btn btn-secondary btn-sm" onClick={() => handleOpenCreateModal()}>
                <Plus size={14} /> Create Room
              </button>
            </div>
          ) : (
            <div className="rooms-grid">
              {filteredRooms.map((r) => (
                <div key={r.id} className="room-card">
                  <div className="room-card-header">
                    <span className="room-card-title" title={r.name}>
                      {r.name}
                    </span>
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

        {/* Section 2: Media Library */}
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
              <Film size={16} />
              <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>Media Library</h3>
              {!loadingMovies && movies.length > 0 && (
                <span className="badge">{movies.length} {movies.length === 1 ? 'file' : 'files'}</span>
              )}
            </div>
          </div>

          {loadingMovies ? (
            <div style={{ padding: 'var(--sp-8)', display: 'flex', justifyContent: 'center', color: 'var(--text-3)' }}>
              <Loader2 className="spinner" size={24} />
            </div>
          ) : error ? (
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', borderColor: 'var(--error)' }}>
              <AlertCircle color="var(--error)" size={20} />
              <div style={{ flex: 1 }}>
                <p style={{ color: 'var(--text-1)', fontSize: '0.875rem', fontWeight: 500 }}>Failed to load library</p>
                <p style={{ color: 'var(--error)', fontSize: '0.8125rem' }}>{error}</p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={fetchMoviesList}>Retry</button>
            </div>
          ) : movies.length === 0 ? (
            <div className="card" style={{ padding: 'var(--sp-8)', textAlign: 'center', color: 'var(--text-2)' }}>
              <Film size={32} style={{ margin: '0 auto var(--sp-2)', opacity: 0.4 }} />
              <p style={{ fontWeight: 500, color: 'var(--text-1)' }}>Your library is empty</p>
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-3)' }}>Upload a video file below to get started.</p>
            </div>
          ) : (
            <div className="movie-grid">
              {movies.map((movie) => (
                <MovieCard
                  key={movie.id}
                  movie={movie}
                  onSelectForRoom={handleOpenCreateModal}
                />
              ))}
            </div>
          )}
        </section>

        {/* Section 3: Upload Media */}
        <section>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--sp-4)' }}>
            Upload Media
          </h3>
          <UploadZone onUploaded={setMovies} />
        </section>
      </div>

      {/* Create Room Modal */}
      <CreateRoomModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        movies={movies}
        preselectedMovie={preselectedMovie}
        onMovieUploaded={setMovies}
      />

      {/* Profile Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        currentName={profileName}
        onSave={handleProfileSave}
      />
    </div>
  );
}
