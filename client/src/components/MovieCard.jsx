import { useState } from 'react';
import { createRoom } from '../api/index.js';
import { useNavigate } from 'react-router-dom';
import { Film, Play, Loader2 } from 'lucide-react';

export default function MovieCard({ movie }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleCreate() {
    setError('');
    setLoading(true);
    try {
      const room = await createRoom(movie.filename);
      navigate(`/watch/${room.roomId}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="movie-card">
      <div className="movie-card-thumb">
        <Film size={32} strokeWidth={1.5} />
      </div>
      <div className="movie-card-body">
        <div>
          <div className="movie-card-title" title={movie.name}>{movie.name}</div>
          <div className="movie-card-meta">{movie.sizeFormatted}</div>
        </div>
        
        {error && (
          <p style={{ color: 'var(--error)', fontSize: '0.75rem', marginBottom: 'var(--sp-2)' }}>
            {error}
          </p>
        )}
        
        <button
          className="btn btn-secondary"
          style={{ width: '100%', marginTop: 'auto' }}
          onClick={handleCreate}
          disabled={loading}
        >
          {loading ? (
            <><Loader2 className="spinner" size={16} /> Creating...</>
          ) : (
            <><Play size={16} fill="currentColor" /> Watch</>
          )}
        </button>
      </div>
    </div>
  );
}
