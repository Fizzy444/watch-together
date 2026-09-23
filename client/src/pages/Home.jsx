import { useState, useEffect, useCallback } from 'react';
import { getMovies } from '../api/index.js';
import MovieCard from '../components/MovieCard.jsx';
import UploadZone from '../components/UploadZone.jsx';
import { Film, AlertCircle, Loader2, PlaySquare } from 'lucide-react';

export default function Home() {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMovies = useCallback(async () => {
    try {
      const data = await getMovies();
      setMovies(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMovies(); }, [fetchMovies]);

  function handleUploaded(updatedMovies) {
    setMovies(updatedMovies);
  }

  return (
    <div className="container">
      <header style={{ marginBottom: 'var(--sp-8)', display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
        <PlaySquare size={32} />
        <div>
          <h1 style={{ marginBottom: 'var(--sp-1)' }}>Watch Together</h1>
          <p style={{ fontSize: '0.875rem' }}>Synchronized video streaming</p>
        </div>
      </header>

      <div style={{ display: 'grid', gap: 'var(--sp-8)' }}>
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--sp-4)' }}>
            <h3>Library</h3>
            {!loading && movies.length > 0 && (
              <span className="badge">{movies.length} items</span>
            )}
          </div>

          {loading && (
            <div style={{ padding: 'var(--sp-8)', display: 'flex', justifyContent: 'center', color: 'var(--text-3)' }}>
              <Loader2 className="spinner" size={24} />
            </div>
          )}

          {error && !loading && (
            <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', borderColor: 'var(--error)' }}>
              <AlertCircle color="var(--error)" size={20} />
              <div style={{ flex: 1 }}>
                <p style={{ color: 'var(--text-1)', fontSize: '0.875rem', fontWeight: 500 }}>Failed to load library</p>
                <p style={{ color: 'var(--error)', fontSize: '0.875rem' }}>{error}</p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={fetchMovies}>Retry</button>
            </div>
          )}

          {!loading && !error && movies.length === 0 && (
            <div className="card" style={{ padding: 'var(--sp-8)', textAlign: 'center', color: 'var(--text-2)' }}>
              <Film size={32} style={{ margin: '0 auto var(--sp-3)', opacity: 0.5 }} />
              <p style={{ fontWeight: 500, color: 'var(--text-1)' }}>Library is empty</p>
              <p style={{ fontSize: '0.875rem' }}>Upload a video file to begin.</p>
            </div>
          )}

          {!loading && movies.length > 0 && (
            <div className="movie-grid">
              {movies.map((movie) => (
                <MovieCard key={movie.id} movie={movie} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 style={{ marginBottom: 'var(--sp-4)' }}>Upload Media</h3>
          <UploadZone onUploaded={handleUploaded} />
        </section>
      </div>
    </div>
  );
}
