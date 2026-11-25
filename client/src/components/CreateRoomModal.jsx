import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Film, Upload, Zap, Loader2, Globe, Radio, Play } from 'lucide-react';
import { createRoom } from '../api/index.js';
import { getSessionClientId } from '../hooks/useWebSocket.js';

function detectOptimalStreamMode(fileName) {
  const ext = (fileName || '').split('.').pop()?.toLowerCase();
  if (ext === 'mp4' || ext === 'webm') {
    return 'direct';
  }
  return 'hls';
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export default function CreateRoomModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState('');
  const isElectron = Boolean(window.desktopAPI || window.electronAPI);
  const [inputType, setInputType] = useState('tunnel');
  const [streamMode, setStreamMode] = useState('hls');

  const [selectedFile, setSelectedFile] = useState(null);
  const [tunnelUrlInput, setTunnelUrlInput] = useState('');
  const [magnetLink, setMagnetLink] = useState('');
  const [localFile, setLocalFile] = useState(null);
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [tunnelStatusText, setTunnelStatusText] = useState('');
  const [tunnelProgress, setTunnelProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !loading) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, loading]);

  if (!isOpen) return null;

  async function handlePickFile() {
    setError('');
    if (isElectron && window.electronAPI.selectVideoFile) {
      try {
        const res = await window.electronAPI.selectVideoFile();
        if (res) {
          const pickedName = res.fileName || res.name || '';
          const fileObj = {
            name: pickedName,
            fileName: pickedName,
            size: res.fileSize || res.size || 0,
            fileSize: res.fileSize || res.size || 0,
            filePath: res.filePath,
            duration: res.duration || 0,
            recommendedMode: res.recommendedMode || 'hls',
            reason: res.reason || '',
            audioTracks: res.audioTracks || [],
            subtitleTracks: res.subtitleTracks || [],
          };
          setSelectedFile(fileObj);
          setStreamMode(res.recommendedMode || detectOptimalStreamMode(pickedName));
          if (!roomName.trim()) {
            setRoomName(pickedName.replace(/\.[^/.]+$/, ''));
          }
        }
      } catch (err) {
        console.error('Failed to select file:', err);
        setError('Failed to open file picker: ' + err.message);
      }
    } else {
      fileInputRef.current?.click();
    }
  }

  function handleBrowserFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalFile(file);
    setSelectedFile({
      name: file.name,
      size: file.size,
      filePath: null,
    });
    setStreamMode(detectOptimalStreamMode(file.name));
    if (!roomName.trim()) {
      setRoomName(file.name.replace(/\.[^/.]+$/, ''));
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');

    if (inputType === 'tunnel') {
      if (isElectron) {
        if (!selectedFile || !selectedFile.filePath) {
          setError('Please select a video file to stream.');
          return;
        }
      } else if (!tunnelUrlInput.trim() && !selectedFile) {
        setError('Please provide a stream URL or select a file.');
        return;
      }
    } else if (inputType === 'torrent') {
      if (!magnetLink.trim().startsWith('magnet:?')) {
        setError('Please enter a magnet link starting with magnet:?');
        return;
      }
    } else if (inputType === 'local' && !localFile) {
      setError('Please choose a video file for P2P streaming.');
      return;
    }

    setLoading(true);
    try {
      const clientId = getSessionClientId();
      let streamUrl = '';
      let finalMovieName = '';
      let tunnelDuration = 0;

      if (inputType === 'tunnel') {
        if (isElectron && selectedFile?.filePath) {
          setTunnelStatusText('Starting local video server...');
          setTunnelProgress(0);

          const unsubscribe = window.electronAPI.onTunnelStatus?.((status) => {
            if (status.message) setTunnelStatusText(status.message);
            if (typeof status.progress === 'number') setTunnelProgress(status.progress);
          });

          try {
            const tunnelRes = await window.electronAPI.startHostTunnel(
              selectedFile.filePath,
              streamMode
            );
            streamUrl = tunnelRes.streamUrl;
            tunnelDuration = tunnelRes.duration || 0;
            if (tunnelRes.localStreamUrl) {
              window.__hostLocalStreamUrl = tunnelRes.localStreamUrl;
            }
            if (tunnelRes.subtitleUrl) {
              window.__hostSubtitleUrl = tunnelRes.subtitleUrl;
            }
            window.__hostSubtitleTracks =
              tunnelRes.subtitleTracks || selectedFile?.subtitleTracks || [];
            window.__hostAudioTracks = tunnelRes.audioTracks || selectedFile?.audioTracks || [];
            window.__hostFilePath = selectedFile.filePath;
            window.__hostMovieDuration = tunnelDuration;
            window.__hostStreamMode = streamMode;
            window.__hostIsHls = Boolean(tunnelRes.isHls);
            finalMovieName = (selectedFile?.name || selectedFile?.fileName || '').replace(
              /\.[^/.]+$/,
              ''
            );
          } finally {
            unsubscribe?.();
          }
        } else {
          streamUrl = tunnelUrlInput.trim();
          finalMovieName = roomName.trim() || 'Stream Room';
        }

        const finalTitle = roomName.trim() || finalMovieName;
        const room = await createRoom({
          streamType: 'tunnel',
          movie: streamUrl,
          name: finalTitle,
          clientId,
          duration: window.__hostMovieDuration || 0,
          subtitleTracks: window.__hostSubtitleTracks || [],
          audioTracks: window.__hostAudioTracks || [],
        });

        onClose();
        navigate(`/watch/${room.roomId || room.id}`, {
          state: {
            isHost: true,
            localStreamUrl: window.__hostLocalStreamUrl || null,
            subtitleUrl: window.__hostSubtitleUrl || null,
            subtitleTracks: window.__hostSubtitleTracks || [],
            videoPath: selectedFile?.filePath || null,
            audioTracks: window.__hostAudioTracks || selectedFile?.audioTracks || [],
            movieDuration: window.__hostMovieDuration || tunnelDuration,
          },
        });
        return;
      }

      if (inputType === 'torrent') {
        const dnMatch = magnetLink.match(/dn=([^&]+)/);
        const parsedTitle = dnMatch
          ? decodeURIComponent(dnMatch[1].replace(/\+/g, ' '))
          : 'Torrent Stream';
        const finalTitle = roomName.trim() || parsedTitle;

        const room = await createRoom({
          streamType: 'torrent',
          movie: magnetLink.trim(),
          name: finalTitle,
          clientId,
        });

        onClose();
        navigate(`/watch/${room.roomId || room.id}`, {
          state: {
            isHost: true,
            localStreamUrl: window.__hostLocalStreamUrl || null,
            subtitleUrl: window.__hostSubtitleUrl || null,
            videoPath: selectedFile?.filePath || null,
          },
        });
        return;
      }

      if (inputType === 'local') {
        const finalTitle = roomName.trim() || localFile.name.replace(/\.[^/.]+$/, '');
        const room = await createRoom({
          isP2P: true,
          streamType: 'p2p',
          movie: localFile.name,
          name: finalTitle,
          clientId,
        });

        window.__wt_p2p_file = localFile;
        window.__wt_p2p_file_cache = {
          ...(window.__wt_p2p_file_cache || {}),
          [room.roomId || room.id]: localFile,
        };

        onClose();
        navigate(`/watch/${room.roomId || room.id}`, {
          state: {
            isHost: true,
            localStreamUrl: window.__hostLocalStreamUrl || null,
            subtitleUrl: window.__hostSubtitleUrl || null,
            videoPath: selectedFile?.filePath || null,
          },
        });
      }
    } catch (err) {
      console.error('Failed to create room:', err);
      setError(err?.message || 'Failed to create room. Please try again.');
      setLoading(false);
      setTunnelStatusText('');
    }
  }

  const fileMetadataParts = [];
  if (selectedFile) {
    fileMetadataParts.push(formatBytes(selectedFile.size || selectedFile.fileSize));
    if (selectedFile.audioTracks?.length > 1) {
      fileMetadataParts.push(`${selectedFile.audioTracks.length} audio tracks`);
    }
    if (selectedFile.subtitleTracks?.length > 0) {
      fileMetadataParts.push(`${selectedFile.subtitleTracks.length} subtitles`);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !loading && onClose()}>
      <div
        className="modal-content"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <Globe size={18} color="var(--primary)" />
            <h3>Create Room</h3>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleCreate}>
          <div className="modal-body" style={{ gap: 'var(--sp-4)' }}>
            {error && <div className="modal-alert modal-alert-error">{error}</div>}

            <div className="field-group">
              <label htmlFor="create-room-name" className="field-label">
                Room Name
              </label>
              <input
                id="create-room-name"
                type="text"
                className="input"
                placeholder={
                  selectedFile?.name || selectedFile?.fileName
                    ? (selectedFile.name || selectedFile.fileName).replace(/\.[^/.]+$/, '')
                    : 'Movie night'
                }
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                autoFocus
                maxLength={60}
                disabled={loading}
              />
            </div>

            <div className="create-mode-tabs">
              <button
                type="button"
                className={`btn btn-sm ${inputType === 'tunnel' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: '1 1 90px' }}
                onClick={() => setInputType('tunnel')}
                disabled={loading}
              >
                <Globe size={14} />
                <span>Tunnel</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${inputType === 'torrent' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: '1 1 90px' }}
                onClick={() => setInputType('torrent')}
                disabled={loading}
              >
                <Radio size={14} />
                <span>Torrent</span>
              </button>
              <button
                type="button"
                className={`btn btn-sm ${inputType === 'local' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: '1 1 110px' }}
                onClick={() => setInputType('local')}
                disabled={loading}
              >
                <Zap size={14} />
                <span>WebRTC P2P</span>
              </button>
            </div>

            {inputType === 'tunnel' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                {isElectron ? (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept=".mp4,.mkv,.webm,.mov,.avi"
                      style={{ display: 'none' }}
                      onChange={handleBrowserFileSelected}
                    />

                    {selectedFile ? (
                      <>
                        <div className="selected-file-card">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <Film size={20} color="var(--info)" style={{ flexShrink: 0 }} />
                            <div style={{ minWidth: 0 }}>
                              <div className="movie-card-title">
                                {selectedFile.name || selectedFile.fileName}
                              </div>
                              <div className="movie-card-meta">
                                {fileMetadataParts.join(', ')}
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={handlePickFile}
                            disabled={loading}
                          >
                            Change
                          </button>
                        </div>

                        <div className="stream-mode-card">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            {streamMode === 'direct' ? (
                              <Play size={16} color="var(--success)" style={{ flexShrink: 0 }} />
                            ) : (
                              <Zap size={16} color="var(--primary)" style={{ flexShrink: 0 }} />
                            )}
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-1)' }}>
                                {streamMode === 'direct' ? 'Direct Stream' : 'HLS Transmux'}
                                <span style={{ fontSize: '0.6875rem', color: 'var(--text-3)', fontWeight: 400, marginLeft: 6 }}>
                                  {selectedFile?.recommendedMode === streamMode ? 'Auto' : 'Manual'}
                                </span>
                              </div>
                              <div className="movie-card-meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {selectedFile?.reason ||
                                  (streamMode === 'direct'
                                    ? 'HTTP range streaming without transcoding'
                                    : 'Segmented HLS for broader codec and track support')}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setStreamMode(streamMode === 'direct' ? 'hls' : 'direct')}
                            disabled={loading}
                          >
                            {streamMode === 'direct' ? 'Use HLS' : 'Use Direct'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <button type="button" className="file-dropzone" onClick={handlePickFile}>
                        <Upload size={24} color="var(--primary)" />
                        <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: '0.875rem' }}>
                          Choose Local Video File
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>
                          MP4, MKV, WebM, MOV, or AVI
                        </span>
                      </button>
                    )}
                  </>
                ) : (
                  <div className="field-group">
                    <label htmlFor="tunnel-url-input" className="field-label">
                      Stream URL
                    </label>
                    <input
                      id="tunnel-url-input"
                      type="url"
                      className="input"
                      placeholder="https://example.trycloudflare.com/video"
                      value={tunnelUrlInput}
                      onChange={(e) => setTunnelUrlInput(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                )}
              </div>
            )}

            {inputType === 'torrent' && (
              <div className="field-group">
                <label htmlFor="magnet-link-input" className="field-label">
                  Magnet Link
                </label>
                <input
                  id="magnet-link-input"
                  type="text"
                  className="input"
                  placeholder="magnet:?xt=urn:btih:..."
                  value={magnetLink}
                  onChange={(e) => setMagnetLink(e.target.value)}
                  disabled={loading}
                />
              </div>
            )}

            {inputType === 'local' && (
              <div className="field-group">
                <span className="field-label">Local Video File</span>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".mp4,.mkv,.webm,.mov,.avi"
                  style={{ display: 'none' }}
                  onChange={handleBrowserFileSelected}
                />
                <button
                  type="button"
                  className="file-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={22} color="var(--primary)" />
                  <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: '0.8125rem' }}>
                    {localFile ? localFile.name : 'Select video file from device'}
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 4, flex: 1, marginRight: 'var(--sp-4)' }}>
              {loading && tunnelStatusText && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Loader2 className="spinner" size={14} color="var(--primary)" />
                      <span style={{ fontWeight: 500, color: 'var(--text-1)' }}>{tunnelStatusText}</span>
                    </div>
                    {tunnelProgress > 0 && (
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary)' }}>
                        {tunnelProgress}%
                      </span>
                    )}
                  </div>
                  {tunnelProgress > 0 && (
                    <div className="progress">
                      <div className="progress-fill" style={{ width: `${tunnelProgress}%` }} />
                    </div>
                  )}
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  loading ||
                  (inputType === 'tunnel'
                    ? isElectron
                      ? !selectedFile
                      : !tunnelUrlInput.trim()
                    : inputType === 'torrent'
                    ? !magnetLink.trim()
                    : !localFile)
                }
              >
                {loading ? (
                  <>
                    <Loader2 className="spinner" size={16} />
                    <span>Starting...</span>
                  </>
                ) : (
                  <span>Start Room</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
