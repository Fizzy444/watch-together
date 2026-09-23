import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Loader2,
  RotateCcw,
  RotateCw,
  ShieldAlert,
} from 'lucide-react';

// Sync thresholds (seconds)
const HARD_SEEK_THRESHOLD = 8.0;   // Only hard-seek if drift is > 8 seconds
const CATCHUP_THRESHOLD = 0.5;     // Smoothly speed up/down if drift is > 0.5s

function formatTime(s) {
  if (!isFinite(s) || isNaN(s)) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function VideoPlayer({
  src,
  isHost,
  wsMsg,
  initialTime = 0,
  initialPlaying = false,
  wasPlayingBeforeDisconnect = false,
  onPlay,
  onPause,
  onSeek,
  onTimeUpdate,
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideControlsTimer = useRef(null);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3500);
  }, []);

  const handleContainerClick = useCallback((e) => {
    // If clicked on input or button, keep controls visible
    if (e.target.closest("button") || e.target.closest("input")) {
      bumpControls();
      return;
    }
    // Toggle on mobile/touch tap
    setControlsVisible((prev) => {
      if (!prev) {
        bumpControls();
        return true;
      } else {
        clearTimeout(hideControlsTimer.current);
        return false;
      }
    });
  }, [bumpControls]);
  const [hostReconnecting, setHostReconnecting] = useState(false);

  // Play-to-pause catchup for lagging viewers
  const pendingPauseTarget = useRef(null);
  const pendingPauseTimer = useRef(null);

  useEffect(() => {
    return () => {
      clearTimeout(pendingPauseTimer.current);
    };
  }, []);

  // Restore playback state across reload/reconnection
  const hasInitializedTime = useRef(false);
  const pendingInitialTime = useRef(initialTime);
  const pendingInitialPlaying = useRef(initialPlaying);

  useEffect(() => {
    if (initialTime > 0 && !hasInitializedTime.current) {
      pendingInitialTime.current = initialTime;
    }
  }, [initialTime]);

  useEffect(() => {
    if (!hasInitializedTime.current) {
      pendingInitialPlaying.current = initialPlaying;
    }
  }, [initialPlaying]);

  // HUD feedback for shortcuts
  const [hud, setHud] = useState(null);
  const hudTimer = useRef(null);

  const showHud = useCallback((hudData) => {
    clearTimeout(hudTimer.current);
    setHud({ ...hudData, id: Date.now() });
    hudTimer.current = setTimeout(() => {
      setHud(null);
    }, 650);
  }, []);

  // Initialize and load source
  useEffect(() => {
    if (!src || !videoRef.current) return;
    const video = videoRef.current;

    const isHls = src.includes('.m3u8');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setBuffering(false);
      });
      hls.on(Hls.Events.ERROR, (event, data) => {
        console.warn('[HLS]', data.type, data.details);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });
    } else {
      // Direct progressive streaming (MP4 / WebM / native browser player)
      video.src = src;
      video.load();
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src]);

  // Video element event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      setDuration(video.duration);
      if (!hasInitializedTime.current) {
        if (pendingInitialTime.current > 0) {
          video.currentTime = pendingInitialTime.current;
          setCurrentTime(pendingInitialTime.current);
        }
        hasInitializedTime.current = true;
        if (pendingInitialPlaying.current || wasPlayingBeforeDisconnect) {
          video.play()
            .then(() => {
              if (isHostRef.current) {
                onPlay?.(video.currentTime);
              }
            })
            .catch(() => {
              if (isHostRef.current) {
                showHud({ icon: 'play', text: 'Press Space to resume' });
              }
            });
        }
      }
    };

    const onTU = () => {
      setCurrentTime(video.currentTime);

      // If lagging viewer is catching up to host pause timestamp:
      if (pendingPauseTarget.current !== null) {
        if (video.currentTime >= pendingPauseTarget.current - 0.1) {
          clearTimeout(pendingPauseTimer.current);
          const snapTime = pendingPauseTarget.current;
          pendingPauseTarget.current = null;
          video.pause();
          video.currentTime = snapTime;
          video.playbackRate = 1.0;
        }
      }

      // Guard: do not report 0.0s time update before initial timestamp has been established
      if (hasInitializedTime.current) {
        onTimeUpdate?.(video.currentTime);
      }
    };
    const onDM = () => setDuration(video.duration);
    const onWait = () => setBuffering(true);
    const onCanPlay = () => setBuffering(false);
    const onLoadedData = () => setBuffering(false);
    const onPlayEvent = () => {
      setPlaying(true);
      setBuffering(false);
    };
    const onPauseEvent = () => {
      setPlaying(false);
      setBuffering(false);
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTU);
    video.addEventListener('durationchange', onDM);
    video.addEventListener('waiting', onWait);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('playing', onPlayEvent);
    video.addEventListener('pause', onPauseEvent);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTU);
      video.removeEventListener('durationchange', onDM);
      video.removeEventListener('waiting', onWait);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('playing', onPlayEvent);
      video.removeEventListener('pause', onPauseEvent);
    };
  }, [onTimeUpdate]);

  // Buttery-smooth WebSocket sync dispatcher
  useEffect(() => {
    if (!wsMsg || !videoRef.current) return;
    const video = videoRef.current;

    switch (wsMsg.type) {
      case 'room_state': {
        const roomState = wsMsg.room;
        if (roomState && !hasInitializedTime.current) {
          const target = roomState.currentTime || 0;
          pendingInitialTime.current = target;
          pendingInitialPlaying.current = Boolean(roomState.playing);
          if (video.readyState >= 1) {
            if (target > 0) {
              video.currentTime = target;
              setCurrentTime(target);
            }
            hasInitializedTime.current = true;
            if (roomState.playing) {
              video.play().catch(() => {});
            }
          }
        }
        break;
      }
      case 'play': {
        clearTimeout(pendingPauseTimer.current);
        pendingPauseTarget.current = null;
        setHostReconnecting(false);
        if (isHostRef.current) break; // Host already initiated play locally
        const networkLatency = wsMsg.serverTime ? Math.max(0, (Date.now() - wsMsg.serverTime) / 1000 / 2) : 0;
        const targetTime = (wsMsg.position ?? video.currentTime) + networkLatency;
        
        // Only seek if far off (e.g. > 3s)
        if (Math.abs(video.currentTime - targetTime) > 3) {
          video.currentTime = targetTime;
        }
        video.playbackRate = 1.0;
        video.play().catch((err) => console.log('[Playback] Auto-play blocked:', err));
        break;
      }

      case 'pause': {
        if (wsMsg.hostDisconnected) {
          setHostReconnecting(true);
        }
        if (isHostRef.current) break;

        const targetPauseTime = typeof wsMsg.position === 'number' ? wsMsg.position : null;
        const CATCHUP_MAX_LAG = 10.0; // Up to 10s lag: keep playing until target timestamp
        const lag = targetPauseTime !== null ? (targetPauseTime - video.currentTime) : 0;

        if (targetPauseTime !== null && lag > 0.3 && lag <= CATCHUP_MAX_LAG && !video.paused) {
          // Viewer is behind: let them continue playing until they reach the host pause position
          pendingPauseTarget.current = targetPauseTime;
          video.playbackRate = 1.0;

          clearTimeout(pendingPauseTimer.current);
          pendingPauseTimer.current = setTimeout(() => {
            if (pendingPauseTarget.current !== null && videoRef.current) {
              const snap = pendingPauseTarget.current;
              pendingPauseTarget.current = null;
              videoRef.current.pause();
              videoRef.current.currentTime = snap;
            }
          }, Math.max(500, (lag + 1.5) * 1000));
        } else {
          clearTimeout(pendingPauseTimer.current);
          pendingPauseTarget.current = null;
          video.pause();
          if (targetPauseTime !== null) {
            video.currentTime = targetPauseTime;
          }
          video.playbackRate = 1.0;
        }
        break;
      }

      case 'seek': {
        clearTimeout(pendingPauseTimer.current);
        pendingPauseTarget.current = null;
        if (isHostRef.current) break;
        video.currentTime = wsMsg.position ?? video.currentTime;
        video.playbackRate = 1.0;
        break;
      }

      case 'sync_tick': {
        // Do not sync host to themselves
        if (isHostRef.current || !wsMsg.playing) break;
        // Do not interrupt while playing towards pause target
        if (pendingPauseTarget.current !== null) break;

        // If the video is currently buffering or not yet playing, don't interrupt it!
        if (video.seeking || video.readyState < 3) break;

        const networkLatency = wsMsg.serverTime ? Math.max(0, (Date.now() - wsMsg.serverTime) / 1000 / 2) : 0;
        const expected = (wsMsg.position ?? video.currentTime) + networkLatency;
        const drift = expected - video.currentTime; // positive = behind host, negative = ahead of host

        if (Math.abs(drift) > HARD_SEEK_THRESHOLD) {
          // Large desync (> 8s, e.g. skipped forward) -> perform hard seek
          video.currentTime = expected;
          video.playbackRate = 1.0;
        } else if (drift > CATCHUP_THRESHOLD) {
          // Slightly behind host: smoothly speed up by 8% to catch up without buffer flush
          video.playbackRate = 1.08;
        } else if (drift < -CATCHUP_THRESHOLD) {
          // Slightly ahead of host: smoothly slow down by 5%
          video.playbackRate = 0.95;
        } else {
          // Perfectly in sync (within 0.5s): normal speed
          if (video.playbackRate !== 1.0) {
            video.playbackRate = 1.0;
          }
        }
        break;
      }
    }
  }, [wsMsg]);

  // Play / Pause toggle
  const handlePlayPause = useCallback(() => {
    hasInitializedTime.current = true;
    const video = videoRef.current;
    if (!video) return;

    if (!isHostRef.current) {
      showHud({ icon: 'shield', text: 'Only host controls playback' });
      return;
    }

    if (video.paused) {
      video.play().catch((err) => console.error('[Play failed]', err));
      onPlay?.(video.currentTime);
      showHud({ icon: 'play', text: 'Play' });
    } else {
      video.pause();
      onPause?.(video.currentTime);
      showHud({ icon: 'pause', text: 'Pause' });
    }
  }, [onPlay, onPause, showHud]);

  // Skip relative seconds (+5, -5, +10, -10, etc.)
  const handleSkip = useCallback(
    (seconds) => {
      hasInitializedTime.current = true;
      const video = videoRef.current;
      if (!video) return;

      if (!isHostRef.current) {
        showHud({ icon: 'shield', text: 'Only host controls playback' });
        return;
      }

      const totalDur = duration || video.duration || 0;
      const target = Math.max(0, Math.min(totalDur, video.currentTime + seconds));
      video.currentTime = target;
      setCurrentTime(target);
      onSeek?.(target);

      showHud({
        icon: seconds > 0 ? 'forward' : 'backward',
        text: `${seconds > 0 ? '+' : ''}${seconds}s`,
      });
    },
    [duration, onSeek, showHud]
  );

  // Absolute seek from range slider
  const handleSeek = useCallback(
    (e) => {
      if (!isHostRef.current || !videoRef.current) return;
      const t = Number(e.target.value);
      videoRef.current.currentTime = t;
      setCurrentTime(t);
      onSeek?.(t);
    },
    [onSeek]
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
    showHud({
      icon: nextMuted ? 'mute' : 'volume',
      text: nextMuted ? 'Muted' : 'Unmuted',
    });
  }, [showHud]);

  const changeVolume = useCallback(
    (delta) => {
      const video = videoRef.current;
      if (!video) return;
      const nextVol = Math.max(0, Math.min(1, Math.round((video.volume + delta) * 20) / 20));
      video.volume = nextVol;
      video.muted = nextVol === 0;
      setVolume(nextVol);
      setMuted(nextVol === 0);
      showHud({
        icon: nextVol === 0 ? 'mute' : 'volume',
        text: `${Math.round(nextVol * 100)}%`,
      });
    },
    [showHud]
  );

  const handleVolumeInput = (e) => {
    const v = Number(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = v;
      videoRef.current.muted = v === 0;
    }
    setVolume(v);
    setMuted(v === 0);
  };

  const toggleFullscreen = useCallback(() => {
    const el = videoRef.current?.parentElement;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Keyboard shortcuts handler
  useEffect(() => {
    const onKeyDown = (e) => {
      // Don't trigger shortcuts if user is typing in an input or textarea
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        document.activeElement?.isContentEditable
      ) {
        return;
      }

      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          handlePlayPause();
          break;

        case 'ArrowRight':
          e.preventDefault();
          handleSkip(5); // Skip forward 5s
          break;

        case 'ArrowLeft':
          e.preventDefault();
          handleSkip(-5); // Skip backward 5s
          break;

        case 'KeyL':
          e.preventDefault();
          handleSkip(10); // Skip forward 10s (YouTube standard)
          break;

        case 'KeyJ':
          e.preventDefault();
          handleSkip(-10); // Skip backward 10s (YouTube standard)
          break;

        case 'ArrowUp':
          e.preventDefault();
          changeVolume(0.05); // Volume up 5%
          break;

        case 'ArrowDown':
          e.preventDefault();
          changeVolume(-0.05); // Volume down 5%
          break;

        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;

        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;

        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePlayPause, handleSkip, changeVolume, toggleMute, toggleFullscreen]);

  return (
    <div onClick={handleContainerClick} onMouseMove={bumpControls} style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#000' }}>
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        onClick={handlePlayPause}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          cursor: isHost ? 'pointer' : 'default',
        }}
      />

      {/* Host Reconnecting Banner (guests only) */}
      {hostReconnecting && !isHost && (
        <div
          style={{
            position: 'absolute',
            top: 'var(--sp-4)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 15,
            background: 'rgba(0, 0, 0, 0.85)',
            border: '1px solid rgba(234, 179, 8, 0.4)',
            borderRadius: 'var(--r-full)',
            padding: '8px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#eab308',
            fontSize: '0.8125rem',
            fontWeight: 500,
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          <Loader2 className="spinner" size={15} color="#eab308" />
          <span>Host reloaded — paused until host continues</span>
        </div>
      )}

      {/* Buffering Spinner */}
      {buffering && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          <Loader2 className="spinner" size={48} color="rgba(255,255,255,0.85)" />
        </div>
      )}

      {/* Shortcut HUD Indicator */}
      {hud && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 20,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            borderRadius: 'var(--r-lg)',
            padding: '16px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            pointerEvents: 'none',
            animation: 'fadeIn 0.15s ease-out',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          {hud.icon === 'play' && <Play size={32} fill="#fff" color="#fff" />}
          {hud.icon === 'pause' && <Pause size={32} fill="#fff" color="#fff" />}
          {hud.icon === 'forward' && <RotateCw size={32} color="#fff" />}
          {hud.icon === 'backward' && <RotateCcw size={32} color="#fff" />}
          {hud.icon === 'volume' && <Volume2 size={32} color="#fff" />}
          {hud.icon === 'mute' && <VolumeX size={32} color="#ef4444" />}
          {hud.icon === 'shield' && <ShieldAlert size={32} color="#eab308" />}

          <span
            style={{
              fontSize: '0.875rem',
              fontWeight: 500,
              color: hud.icon === 'shield' ? '#eab308' : '#fff',
              letterSpacing: '0.5px',
            }}
          >
            {hud.text}
          </span>
        </div>
      )}

      {/* Player Controls Bar */}
      <div className={`player-controls ${controlsVisible ? "visible" : ""}`}>
        <input
          type="range"
          className="player-seek"
          min={0}
          max={duration || 0}
          step={0.5}
          value={currentTime}
          onChange={handleSeek}
          disabled={!isHost}
          title={isHost ? 'Seek video (← / → to skip 5s, J / L to skip 10s)' : 'Only host can seek'}
          style={{
            cursor: isHost ? 'pointer' : 'not-allowed',
            marginBottom: 'var(--sp-2)',
          }}
        />

        <div className="player-toolbar">
          {/* Play / Pause button */}
          <button
            className="btn-icon"
            onClick={handlePlayPause}
            disabled={!isHost}
            title={
              isHost
                ? playing
                  ? 'Pause (Space / K)'
                  : 'Play (Space / K)'
                : 'Only host can control playback'
            }
            style={{
              cursor: isHost ? 'pointer' : 'not-allowed',
              opacity: isHost ? 1 : 0.5,
            }}
          >
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>

          {/* Skip Backward 10s button */}
          <button
            className="btn-icon"
            onClick={() => handleSkip(-10)}
            disabled={!isHost}
            title={isHost ? 'Skip backward 10s (J / ←)' : 'Only host can skip'}
            style={{
              cursor: isHost ? 'pointer' : 'not-allowed',
              opacity: isHost ? 1 : 0.5,
              padding: '6px',
            }}
          >
            <RotateCcw size={17} />
          </button>

          {/* Skip Forward 10s button */}
          <button
            className="btn-icon"
            onClick={() => handleSkip(10)}
            disabled={!isHost}
            title={isHost ? 'Skip forward 10s (L / →)' : 'Only host can skip'}
            style={{
              cursor: isHost ? 'pointer' : 'not-allowed',
              opacity: isHost ? 1 : 0.5,
              padding: '6px',
            }}
          >
            <RotateCw size={17} />
          </button>

          <span className="player-time">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <div style={{ flex: 1 }} />

          {/* Volume toggle */}
          <button
            className="btn-icon"
            onClick={toggleMute}
            title={muted ? 'Unmute (M)' : 'Mute (M)'}
          >
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>

          <input
            type="range"
            className="player-volume-slider"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={handleVolumeInput}
            title="Volume (↑ / ↓)"
            style={{
              width: 80,
              cursor: 'pointer',
              accentColor: '#fff',
              marginLeft: 'var(--sp-2)',
              marginRight: 'var(--sp-4)',
            }}
          />

          {/* Fullscreen button */}
          <button
            className="btn-icon"
            onClick={toggleFullscreen}
            title="Fullscreen (F)"
          >
            <Maximize size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
