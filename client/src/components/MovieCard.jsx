import { Film, Play, Trash2 } from 'lucide-react';

export default function MovieCard({ movie, onSelectForRoom, onRemove }) {
  return (
    <div className="movie-card" style={{ position: 'relative' }}>
      {onRemove && (
        <button
          className="btn-icon"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(movie);
          }}
          title="Remove from my library"
          style={{
            position: 'absolute',
            top: 'var(--sp-2)',
            right: 'var(--sp-2)',
            zIndex: 2,
            background: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            borderRadius: 'var(--r-sm)',
            padding: 5,
            opacity: 0.6,
            transition: 'opacity 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.color = 'var(--error)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '0.6';
            e.currentTarget.style.color = 'var(--text-2)';
          }}
        >
          <Trash2 size={13} />
        </button>
      )}

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
