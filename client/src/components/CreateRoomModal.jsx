import { useState, useEffect } from 'react';
import { createRoom } from '../api/index.js';
import { getSessionClientId } from '../hooks/useWebSocket.js';
import { addMovieToUserLibrary } from '../utils/library.js';
import { useNavigate } from 'react-router-dom';
import UploadZone from './UploadZone.jsx';
import { X, Film, Loader2, Plus, Check } from 'lucide-react';

export default function CreateRoomModal({
  isOpen,
  onClose,
  movies = [],
  preselectedMovie = null,
  onMovieUploaded,
}) {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState('');
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (preselectedMovie) {
      setSelectedMovie(preselectedMovie);
      setRoomName((prev) => (prev ? prev : preselectedMovie.name || ''));
    } else if (movies.length > 0 && !selectedMovie) {
      setSelectedMovie(movies[0]);
    }
  }, [preselectedMovie, movies]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleCreate(e) {
    e.preventDefault();
    if (!selectedMovie) {
      setError('Please select a video file');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const clientId = getSessionClientId();
      const room = await createRoom(
        selectedMovie.filename,
        roomName.trim() || selectedMovie.name,
        clientId
      );
      addMovieToUserLibrary(selectedMovie.filename, movies);
      onClose();
      navigate(`/watch/${room.roomId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleUploaded(updatedMovies) {
    onMovieUploaded?.(updatedMovies);
    setShowUpload(false);
    if (updatedMovies.length > 0) {
      const newest = updatedMovies[updatedMovies.length - 1];
      setSelectedMovie(newest);
      if (!roomName) setRoomName(newest.name);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Create Watch Room</h3>
          <button className="btn-icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleCreate}>
          <div className="modal-body">
            {error && (
              <div
                style={{
                  padding: 'var(--sp-2) var(--sp-3)',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid var(--error)',
                  borderRadius: 'var(--r-md)',
                  color: 'var(--error)',
                  fontSize: '0.8125rem',
                }}
              >
                {error}
              </div>
            )}

            {/* Room Name Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-1)' }}>
                Room Name
              </label>
              <input
                type="text"
                className="input"
                placeholder={selectedMovie ? selectedMovie.name : 'e.g. Movie Night with Friends'}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                autoFocus
                maxLength={60}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                Optional. Defaults to the movie title if left blank.
              </span>
            </div>

            {/* Choose Video File */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-1)' }}>
                  Choose Video File
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: '0.75rem', padding: '0 var(--sp-2)' }}
                  onClick={() => setShowUpload((v) => !v)}
                >
                  <Plus size={14} />
                  {showUpload ? 'Pick from library' : 'Upload new file'}
                </button>
              </div>

              {showUpload ? (
                <div style={{ padding: 'var(--sp-2)', background: 'var(--bg)', borderRadius: 'var(--r-md)' }}>
                  <UploadZone onUploaded={handleUploaded} />
                </div>
              ) : movies.length === 0 ? (
                <div
                  style={{
                    padding: 'var(--sp-6)',
                    background: 'var(--bg)',
                    border: '1px dashed var(--border)',
                    borderRadius: 'var(--r-md)',
                    textAlign: 'center',
                    color: 'var(--text-3)',
                    fontSize: '0.8125rem',
                  }}
                >
                  <Film size={24} style={{ margin: '0 auto var(--sp-2)', opacity: 0.5 }} />
                  <p style={{ color: 'var(--text-2)', marginBottom: 'var(--sp-2)' }}>No movies in library</p>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowUpload(true)}
                  >
                    Upload Video Now
                  </button>
                </div>
              ) : (
                <div className="movie-picker-list">
                  {movies.map((m) => {
                    const isSelected = selectedMovie?.id === m.id || selectedMovie?.filename === m.filename;
                    return (
                      <div
                        key={m.id}
                        className={`movie-picker-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedMovie(m);
                          if (!roomName) setRoomName(m.name);
                        }}
                      >
                        <div className="movie-picker-radio">
                          {isSelected && <Check size={10} color="#000" />}
                        </div>
                        <Film size={18} color="var(--text-2)" style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '0.8125rem',
                              fontWeight: isSelected ? 600 : 400,
                              color: 'var(--text-1)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {m.name}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>
                            {m.sizeFormatted}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading || !selectedMovie}>
              {loading ? (
                <>
                  <Loader2 className="spinner" size={16} /> Creating...
                </>
              ) : (
                'Create & Enter Room'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
