import { useState, useRef } from 'react';
import { uploadMovie } from '../api/index.js';
import { UploadCloud, Loader2 } from 'lucide-react';

const ALLOWED = ['.mp4', '.mkv', '.avi', '.webm', '.mov'];

export default function UploadZone({ onUploaded }) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const inputRef = useRef(null);

  function validateFile(file) {
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!ALLOWED.includes(ext)) {
      return `Unsupported format: ${ext}. Allowed: ${ALLOWED.join(', ')}`;
    }
    return null;
  }

  async function handleFile(file) {
    const err = validateFile(file);
    if (err) { setError(err); return; }

    setError('');
    setUploading(true);
    setProgress(0);
    setFileName(file.name);

    try {
      const result = await uploadMovie(file, setProgress);
      onUploaded?.(result.movies);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      setProgress(0);
      setFileName('');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onInputChange(e) {
    const file = e.target.files[0];
    if (file) handleFile(file);
    e.target.value = '';
  }

  return (
    <div>
      <div
        className={`upload-zone${dragOver ? ' drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        style={{ cursor: uploading ? 'default' : 'pointer' }}
      >
        {!uploading && (
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED.join(',')}
            onChange={onInputChange}
            style={{ display: 'none' }}
          />
        )}

        {uploading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-4)', width: '100%', maxWidth: 320 }}>
            <Loader2 className="spinner" size={24} color="var(--text-2)" />
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-2)', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fileName}</span>
                <span style={{ color: 'var(--text-2)' }}>{progress}%</span>
              </div>
              <div className="progress">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </div>
        ) : (
          <>
            <UploadCloud size={32} color="var(--text-3)" style={{ marginBottom: 'var(--sp-2)' }} />
            <div>
              <p style={{ fontWeight: 500, color: 'var(--text-1)' }}>Click or drag file to this area to upload</p>
              <p style={{ fontSize: '0.875rem', marginTop: 'var(--sp-1)' }}>Support for a single or bulk upload. Strictly prohibit from uploading company data or other band files.</p>
            </div>
            <p style={{ marginTop: 'var(--sp-4)', fontSize: '0.75rem', color: 'var(--text-3)' }}>
              Allowed extensions: {ALLOWED.join(', ')}
            </p>
          </>
        )}
      </div>
      {error && (
        <p style={{ marginTop: 'var(--sp-2)', color: 'var(--error)', fontSize: '0.875rem' }}>
          {error}
        </p>
      )}
    </div>
  );
}
