import { Film, Play } from 'lucide-react';

export default function MovieCard({ movie, onSelectForRoom }) {
  return (
    <div className="movie-card">
      <div className="movie-card-thumb">
        <Film size={32} strokeWidth={1.5} />
      </div>
      <div className="movie-card-body">
        <div>
          <div className="movie-card-title" title={movie.name}>
            {movie.name}
          </div>
          <div className="movie-card-meta">{movie.sizeFormatted}</div>
        </div>

        <button
          className="btn btn-secondary btn-sm"
          style={{ width: '100%', marginTop: 'auto' }}
          onClick={() => onSelectForRoom?.(movie)}
        >
          <Play size={14} fill="currentColor" />
          Create Room
        </button>
      </div>
    </div>
  );
}
