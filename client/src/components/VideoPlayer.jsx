import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import Hls from 'hls.js';
import WebTorrent from 'webtorrent/dist/webtorrent.min.js';
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
  Zap,
  Subtitles,
  Check,
  FileText,
} from 'lucide-react';
import { createVttBlobUrl, getFriendlySubtitleLabel } from '../utils/subtitles.js';

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

const VideoPlayer = forwardRef(function VideoPlayer({
  src,
  videoPath = null,
  streamObject = null,
  isP2P = false,
  p2pStatus = null,
  isTorrent = false,
  torrentMagnet = null,
  onStreamReady = null,
  isHost,
  initialTime = 0,
  initialPlaying = false,
  wasPlayingBeforeDisconnect = false,
  onPlay,
  onPause,
  onSeek,
  onTimeUpdate,
}, ref) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [autoplayMuted, setAutoplayMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideControlsTimer = useRef(null);
  const torrentSrcSetRef = useRef(false);
  const [torrentStatusText, setTorrentStatusText] = useState("");
  const [torrentError, setTorrentError] = useState("");

  // Subtitle / Caption State
  const [subtitlesMenuOpen, setSubtitlesMenuOpen] = useState(false);
  const [activeSubtitleId, setActiveSubtitleId] = useState('off');
  const [embeddedTracks, setEmbeddedTracks] = useState([]);
  const [externalSubtitles, setExternalSubtitles] = useState([]);
  const hiddenSubFileInputRef = useRef(null);
  const subtitleBlobUrlsRef = useRef(new Set());

  // Revoke any created blob URLs on unmount
  useEffect(() => {
    const urls = subtitleBlobUrlsRef.current;
    return () => {
      urls.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch {}
      });
    };
  }, []);

  // Sync volume and muted state to DOM element
  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = muted;
    }
  }, [volume, muted]);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3500);
  }, []);

  const handleUnmutePrompt = useCallback((e) => {
    e?.stopPropagation?.();
    const video = videoRef.current;
    if (video) {
      video.muted = false;
      const targetVol = volume > 0 ? volume : 1;
      video.volume = targetVol;
      setVolume(targetVol);
      setMuted(false);
      setAutoplayMuted(false);
      if (video.paused) {
        video.play().catch(() => {});
      }
    }
  }, [volume]);

  const handleContainerClick = useCallback((e) => {
    if (autoplayMuted && videoRef.current?.muted) {
      handleUnmutePrompt(e);
    }
    // If clicked on input, button, or captions menu, keep controls visible
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".player-captions-menu")) {
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
  }, [bumpControls, autoplayMuted, handleUnmutePrompt]);
  const [hostReconnecting, setHostReconnecting] = useState(false);

  // WebRTC remote streamObject attachment (Viewer in P2P mode)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (streamObject) {
      console.log(
        "[VideoPlayer] Attaching WebRTC streamObject. Tracks - Video:",
        streamObject.getVideoTracks().length,
        "Audio:",
        streamObject.getAudioTracks().length
      );
      video.srcObject = streamObject;

      const handleTrackChange = () => {
        console.log(
          "[VideoPlayer] streamObject track change. Video:",
          streamObject.getVideoTracks().length,
          "Audio:",
          streamObject.getAudioTracks().length
        );
        video.srcObject = new MediaStream(streamObject.getTracks());
        video.play().catch(() => {});
      };

      streamObject.addEventListener("addtrack", handleTrackChange);
      streamObject.addEventListener("removetrack", handleTrackChange);

      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn("[VideoPlayer] Autoplay prevented by browser, muting to allow initial render:", err);
          video.muted = true;
          setMuted(true);
          setAutoplayMuted(true);
          video.play().catch(() => {});
        });
      }
      return () => {
        streamObject.removeEventListener("addtrack", handleTrackChange);
        streamObject.removeEventListener("removetrack", handleTrackChange);
        video.srcObject = null;
      };
    }
  }, [streamObject]);

  // WebTorrent / Electron Initialization
  useEffect(() => {
    if (!isTorrent || !torrentMagnet || !videoRef.current) return;
    
    let isCancelled = false;

    // Electron Desktop App Mode
    if (window.electronAPI) {
      console.log("[VideoPlayer] Initializing Native WebTorrent via Electron...");
      setTorrentStatusText("Connecting to BitTorrent swarm (finding seeders)...");
      setTorrentError("");

      const removeProgress = window.electronAPI.onTorrentProgress?.((data) => {
        if (isCancelled) return;
        if (!data.hasMetadata) {
          if (data.numPeers > 0) {
            setTorrentStatusText(`Connected to ${data.numPeers} seeder${data.numPeers === 1 ? '' : 's'} • Finding video metadata...`);
          } else {
            setTorrentStatusText("Connecting to BitTorrent swarm (finding seeders)...");
          }
        } else {
          const speedKB = (data.downloadSpeed / 1024).toFixed(0);
          setTorrentStatusText(`Buffering video from ${data.numPeers} seeder${data.numPeers === 1 ? '' : 's'} (${speedKB} KB/s)...`);
        }
      });

      const removeError = window.electronAPI.onTorrentError?.((err) => {
        if (isCancelled) return;
        console.error("Electron Torrent Error:", err);
        const msg = typeof err === 'string' ? err : err?.message || 'Torrent error occurred';
        if (!msg.includes('reply was never sent') && !msg.includes('Torrent cancelled')) {
          setTorrentError(msg);
        }
      });

      window.electronAPI.startTorrent(torrentMagnet).then((data) => {
        if (isCancelled) return;
        console.log("[VideoPlayer] Native stream ready:", data.streamUrl);
        setTorrentStatusText(`Buffering ${data.fileName}...`);
        const video = videoRef.current;
        if (video) {
          torrentSrcSetRef.current = true;
          video.src = data.streamUrl;
        }
      }).catch(err => {
        if (isCancelled) return;
        const msg = err?.message || 'Failed to start torrent stream';
        if (!msg.includes('reply was never sent') && !msg.includes('Torrent cancelled')) {
          console.error("Electron Torrent Error:", err);
          setTorrentError(msg);
        }
      });

      return () => {
        isCancelled = true;
        torrentSrcSetRef.current = false;
        removeProgress?.();
        removeError?.();
        window.electronAPI.stopTorrent();
      };
    } 
    
    // Web Browser Fallback Mode (WebRTC)
    console.log("[VideoPlayer] Initializing Browser WebTorrent for magnet:", torrentMagnet);
    const client = new WebTorrent();
    
    client.on('error', (err) => {
      console.error('[WebTorrent] Error:', err);
    });

    client.add(torrentMagnet, (torrent) => {
      if (isCancelled) return;
      console.log("[WebTorrent] Torrent added, metadata ready.");
      
      let largestFile = torrent.files[0];
      for (const file of torrent.files) {
        if (file.length > largestFile.length) {
          largestFile = file;
        }
      }
      
      largestFile.renderTo(videoRef.current, { autoplay: false }, (err) => {
        if (err) console.error('[WebTorrent] renderTo error:', err);
      });
    });

    return () => {
      isCancelled = true;
      console.log("[VideoPlayer] Destroying WebTorrent client");
      client.destroy();
    };
  }, [isTorrent, torrentMagnet]);

  // Host stream capture listener (triggers as soon as metadata/canplay/play is ready)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onStreamReady || !isHost) return;

    const tryCapture = () => {
      if (video.readyState >= 1) {
        try {
          const stream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
          if (stream && stream.getTracks().length > 0) {
            console.log("[VideoPlayer] Captured local host stream for P2P, tracks:", stream.getTracks().length);
            onStreamReady(stream);
          }
        } catch (err) {
          console.warn("[VideoPlayer] captureStream error:", err);
        }
      }
    };

    tryCapture();
    video.addEventListener("loadedmetadata", tryCapture);
    video.addEventListener("canplay", tryCapture);
    video.addEventListener("play", tryCapture);

    return () => {
      video.removeEventListener("loadedmetadata", tryCapture);
      video.removeEventListener("canplay", tryCapture);
      video.removeEventListener("play", tryCapture);
    };
  }, [src, isHost, onStreamReady]);

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

  // Refresh embedded subtitles from HTML5 video element
  const refreshEmbeddedTracks = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return;

    const found = [];
    for (let i = 0; i < video.textTracks.length; i++) {
      const t = video.textTracks[i];
      if (t.kind === 'subtitles' || t.kind === 'captions' || !t.kind) {
        if (t.id && t.id.startsWith('ext-')) continue;
        const label = t.label || (t.language ? `Language: ${t.language.toUpperCase()}` : `Track ${i + 1}`);
        found.push({
          id: `embedded-${i}`,
          index: i,
          label,
          language: t.language,
          kind: t.kind,
        });
      }
    }
    setEmbeddedTracks(found);
  }, []);

  // Auto-detect local matching subtitles (same basename as video) in Electron
  useEffect(() => {
    if (!window.electronAPI?.findMatchingSubtitles) return;
    const targetPath = videoPath || (typeof window !== 'undefined' ? window.__hostFilePath : null);

    window.electronAPI.findMatchingSubtitles(targetPath).then((matches) => {
      if (!matches || matches.length === 0) return;
      console.log(`[VideoPlayer] Found ${matches.length} matching subtitle file(s):`, matches.map(m => m.fileName));

      const newTracks = matches.map((m, idx) => {
        const blobUrl = createVttBlobUrl(m.content, m.format);
        subtitleBlobUrlsRef.current.add(blobUrl);
        const friendlyLabel = getFriendlySubtitleLabel(m.fileName);
        return {
          id: `external-auto-${idx}`,
          label: friendlyLabel,
          fileName: m.fileName,
          format: m.format,
          blobUrl,
          isAutoDetected: true,
        };
      });

      setExternalSubtitles((prev) => {
        const existingNames = new Set(prev.map(p => p.fileName));
        const filtered = newTracks.filter(n => !existingNames.has(n.fileName));
        return [...prev, ...filtered];
      });
    }).catch((err) => {
      console.warn("[VideoPlayer] Error finding matching subtitles:", err);
    });
  }, [videoPath, src]);

  // Activate chosen subtitle
  const handleSelectSubtitle = useCallback((trackId) => {
    const video = videoRef.current;
    if (!video) return;

    setActiveSubtitleId(trackId);
    setSubtitlesMenuOpen(false);

    if (trackId === 'off') {
      if (video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'disabled';
        }
      }
      const existingTracks = video.querySelectorAll('track[data-wt-sub]');
      existingTracks.forEach((t) => t.remove());
      showHud({ icon: 'subtitles', text: 'Subtitles Off' });
      return;
    }

    if (trackId.startsWith('embedded-')) {
      const idx = parseInt(trackId.replace('embedded-', ''), 10);
      const existingTracks = video.querySelectorAll('track[data-wt-sub]');
      existingTracks.forEach((t) => t.remove());

      if (video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = (i === idx) ? 'showing' : 'disabled';
        }
      }
      const label = embeddedTracks.find(t => t.id === trackId)?.label || 'Embedded Track';
      showHud({ icon: 'subtitles', text: label });
      return;
    }

    if (trackId.startsWith('external-')) {
      if (video.textTracks) {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'disabled';
        }
      }

      const sub = externalSubtitles.find(s => s.id === trackId);
      if (!sub) return;

      const existingTracks = video.querySelectorAll('track[data-wt-sub]');
      existingTracks.forEach((t) => t.remove());

      const trackEl = document.createElement('track');
      trackEl.kind = 'subtitles';
      trackEl.label = sub.label;
      trackEl.src = sub.blobUrl;
      trackEl.srclang = 'en';
      trackEl.default = true;
      trackEl.setAttribute('data-wt-sub', 'true');
      trackEl.setAttribute('id', `ext-${trackId}`);

      video.appendChild(trackEl);
      trackEl.track.mode = 'showing';

      showHud({ icon: 'subtitles', text: sub.label });
    }
  }, [embeddedTracks, externalSubtitles, showHud]);

  // Load custom subtitle file
  const handleLoadCustomSubtitle = useCallback(async () => {
    setSubtitlesMenuOpen(false);

    if (window.electronAPI?.selectSubtitleFile) {
      try {
        const file = await window.electronAPI.selectSubtitleFile();
        if (!file) return;

        const blobUrl = createVttBlobUrl(file.content, file.format);
        subtitleBlobUrlsRef.current.add(blobUrl);
        const id = `external-custom-${Date.now()}`;
        const newSub = {
          id,
          label: getFriendlySubtitleLabel(file.fileName),
          fileName: file.fileName,
          format: file.format,
          blobUrl,
          isAutoDetected: false,
        };

        setExternalSubtitles(prev => [...prev, newSub]);
        handleSelectSubtitle(id);
      } catch (err) {
        console.error("Failed to select subtitle file:", err);
      }
      return;
    }

    hiddenSubFileInputRef.current?.click();
  }, [handleSelectSubtitle]);

  const handleBrowserSubtitleSelected = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (!content) return;

      const ext = file.name.split('.').pop()?.toLowerCase() || 'srt';
      const blobUrl = createVttBlobUrl(content, ext);
      subtitleBlobUrlsRef.current.add(blobUrl);
      const id = `external-browser-${Date.now()}`;
      const newSub = {
        id,
        label: getFriendlySubtitleLabel(file.name),
        fileName: file.name,
        format: ext,
        blobUrl,
        isAutoDetected: false,
      };

      setExternalSubtitles(prev => [...prev, newSub]);
      handleSelectSubtitle(id);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [handleSelectSubtitle]);

  const toggleSubtitles = useCallback(() => {
    if (activeSubtitleId !== 'off') {
      handleSelectSubtitle('off');
    } else {
      if (externalSubtitles.length > 0) {
        handleSelectSubtitle(externalSubtitles[0].id);
      } else if (embeddedTracks.length > 0) {
        handleSelectSubtitle(embeddedTracks[0].id);
      } else {
        setSubtitlesMenuOpen(prev => !prev);
      }
    }
  }, [activeSubtitleId, externalSubtitles, embeddedTracks, handleSelectSubtitle]);

  // Close subtitles menu on outside click
  useEffect(() => {
    if (!subtitlesMenuOpen) return;
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.player-captions-wrapper')) {
        setSubtitlesMenuOpen(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [subtitlesMenuOpen]);

  // Video element event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onLoadedMetadata = () => {
      setDuration(video.duration);
      refreshEmbeddedTracks();
      if (isHostRef.current && onStreamReady) {
        try {
          const stream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
          if (stream) {
            console.log("[VideoPlayer] Local stream captured via captureStream");
            onStreamReady(stream);
          }
        } catch (err) {
          console.warn("[VideoPlayer] captureStream failed:", err);
        }
      }
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
    const onVolumeChange = () => {
      setVolume(video.volume);
      setMuted(video.muted);
      if (!video.muted && video.volume > 0) {
        setAutoplayMuted(false);
      }
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTU);
    video.addEventListener('durationchange', onDM);
    video.addEventListener('waiting', onWait);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('playing', onPlayEvent);
    video.addEventListener('pause', onPauseEvent);
    video.addEventListener('volumechange', onVolumeChange);

    const textTracks = video.textTracks;
    if (textTracks) {
      textTracks.addEventListener('addtrack', refreshEmbeddedTracks);
      textTracks.addEventListener('removetrack', refreshEmbeddedTracks);
    }

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTU);
      video.removeEventListener('durationchange', onDM);
      video.removeEventListener('waiting', onWait);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('playing', onPlayEvent);
      video.removeEventListener('pause', onPauseEvent);
      video.removeEventListener('volumechange', onVolumeChange);

      if (textTracks) {
        textTracks.removeEventListener('addtrack', refreshEmbeddedTracks);
        textTracks.removeEventListener('removetrack', refreshEmbeddedTracks);
      }
    };
  }, [onTimeUpdate, refreshEmbeddedTracks]);

  // Expose imperative handle for sync message dispatch
  useImperativeHandle(ref, () => ({
    handleSyncMessage(wsMsg) {
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
    }
  }));

  // Play / Pause toggle
  const handlePlayPause = useCallback(() => {
    hasInitializedTime.current = true;
    const video = videoRef.current;
    if (!video) return;

    if (autoplayMuted && video.muted) {
      video.muted = false;
      setMuted(false);
      setAutoplayMuted(false);
    }

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
  }, [onPlay, onPause, showHud, autoplayMuted]);

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
    if (!nextMuted) setAutoplayMuted(false);
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
      if (nextVol > 0) setAutoplayMuted(false);
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
    if (v > 0) setAutoplayMuted(false);
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

        case 'KeyC':
          e.preventDefault();
          toggleSubtitles();
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
  }, [handlePlayPause, handleSkip, changeVolume, toggleMute, toggleSubtitles, toggleFullscreen]);

  return (
    <div onClick={handleContainerClick} onMouseMove={bumpControls} style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#000' }}>
      <video
        ref={videoRef}
        playsInline
        preload="metadata"
        onClick={handlePlayPause}
        onError={(e) => {
          console.warn("[VideoPlayer] Video element error event:", e.target?.error?.code, e.target?.error?.message);
          // Only show a decode error if we actually set a real stream URL.
          // The video element fires an error naturally when it has no src (empty src = MEDIA_ERR_SRC_NOT_SUPPORTED).
          if (isTorrent && torrentSrcSetRef.current) {
            const code = e.target?.error?.code;
            // MEDIA_ERR_SRC_NOT_SUPPORTED = 4 (unplayable format)
            // MEDIA_ERR_DECODE = 3
            if (code === 4 || code === 3) {
              setTorrentError("Video decoding error: The video format inside this torrent cannot be played by the HTML5 video engine.");
            }
          }
        }}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          cursor: isHost ? 'pointer' : 'default',
        }}
      />

      {/* P2P Badges & Overlays */}
      {isP2P && isHost && (
        <div
          style={{
            position: "absolute",
            top: "var(--sp-4)",
            left: "var(--sp-4)",
            zIndex: 10,
            background: "rgba(0, 0, 0, 0.75)",
            border: "1px solid rgba(16, 185, 129, 0.4)",
            borderRadius: "var(--r-full)",
            padding: "5px 12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: "#10b981",
            fontSize: "0.75rem",
            fontWeight: 600,
            backdropFilter: "blur(8px)",
            pointerEvents: "none",
          }}
        >
          <Zap size={13} />
          <span>Broadcasting P2P • {p2pStatus?.viewersCount || 0} Viewer{p2pStatus?.viewersCount === 1 ? "" : "s"}</span>
        </div>
      )}

      {isP2P && !isHost && streamObject && (
        <div
          style={{
            position: "absolute",
            top: "var(--sp-4)",
            left: "var(--sp-4)",
            zIndex: 10,
            background: "rgba(0, 0, 0, 0.75)",
            border: "1px solid rgba(59, 130, 246, 0.4)",
            borderRadius: "var(--r-full)",
            padding: "5px 12px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            color: "#60a5fa",
            fontSize: "0.75rem",
            fontWeight: 600,
            backdropFilter: "blur(8px)",
            pointerEvents: "none",
          }}
        >
          <Zap size={13} />
          <span>Live P2P Stream</span>
        </div>
      )}

            {(isP2P && !isHost && !streamObject) || (isTorrent && !duration) ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 12,
            background: "rgba(10, 10, 10, 0.95)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "14px",
            padding: "32px",
            textAlign: "center",
          }}
        >
          {torrentError ? (
            <>
              <ShieldAlert size={42} color="#ef4444" />
              <div style={{ fontSize: "1rem", fontWeight: 600, color: "#f87171", maxWidth: 500, lineHeight: 1.5 }}>
                {torrentError}
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-3)", maxWidth: 460 }}>
                Tip: Torrents must contain direct playable video files (.mp4, .mkv, .webm), not raw disk images (.iso) or compressed archives (.rar, .zip).
              </div>
            </>
          ) : (
            <>
              <Loader2 className="spinner" size={36} color="var(--primary)" />
              <div style={{ fontSize: "0.9375rem", fontWeight: 600, color: "var(--text-1)" }}>
                {isTorrent 
                  ? (torrentStatusText || "Connecting to Torrent Swarm (finding seeders)...") 
                  : p2pStatus?.connectionState === "connecting"
                    ? "Connecting to Host P2P Stream..."
                    : "Waiting for Host to begin broadcast..."}
              </div>
              <div style={{ fontSize: "0.8125rem", color: "var(--text-3)" }}>
                {isTorrent ? "Native High-Speed BitTorrent Streaming" : "Encrypted direct device-to-device WebRTC"}
              </div>
            </>
          )}
        </div>
      ) : null}

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
          {hud.icon === 'subtitles' && <Subtitles size={32} color="#fff" />}

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

      {/* Audio Muted Indicator Banner */}
      {muted && playing && (
        <button
          className="player-unmute-banner"
          onClick={handleUnmutePrompt}
          title="Click to unmute video"
        >
          <VolumeX size={15} />
          <span>Audio is muted — Click to unmute</span>
        </button>
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

          {/* Captions / Subtitles Button & Popover */}
          <div className="player-captions-wrapper">
            <button
              className={`btn-icon ${activeSubtitleId !== 'off' ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setSubtitlesMenuOpen((prev) => !prev);
              }}
              title={`Subtitles (${activeSubtitleId !== 'off' ? 'On' : 'Off'}) [C]`}
              style={{
                color: activeSubtitleId !== 'off' ? 'var(--primary)' : 'inherit',
                position: 'relative',
                marginRight: 'var(--sp-2)',
              }}
            >
              <Subtitles size={18} />
              {activeSubtitleId !== 'off' && (
                <span
                  style={{
                    position: 'absolute',
                    bottom: 3,
                    right: 3,
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: 'var(--primary)',
                  }}
                />
              )}
            </button>

            {/* Subtitles Menu */}
            {subtitlesMenuOpen && (
              <div
                className="player-captions-menu"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="player-captions-header">Subtitles</div>

                {/* Off Option */}
                <button
                  className={`player-captions-item ${activeSubtitleId === 'off' ? 'active' : ''}`}
                  onClick={() => handleSelectSubtitle('off')}
                >
                  <span className="player-captions-check">
                    {activeSubtitleId === 'off' && <Check size={14} />}
                  </span>
                  <span>Off</span>
                </button>

                {/* Local matching files (Same name as video) */}
                {externalSubtitles.filter((s) => s.isAutoDetected).length > 0 && (
                  <>
                    <div className="player-captions-divider" />
                    <div className="player-captions-subheader">Local File (Matching Video)</div>
                    {externalSubtitles.filter((s) => s.isAutoDetected).map((sub) => (
                      <button
                        key={sub.id}
                        className={`player-captions-item ${activeSubtitleId === sub.id ? 'active' : ''}`}
                        onClick={() => handleSelectSubtitle(sub.id)}
                        title={sub.fileName}
                      >
                        <span className="player-captions-check">
                          {activeSubtitleId === sub.id && <Check size={14} />}
                        </span>
                        <span className="player-captions-text">
                          {sub.label}
                        </span>
                        <span className="player-captions-tag">Local</span>
                      </button>
                    ))}
                  </>
                )}

                {/* Embedded Subtitles inside container */}
                {embeddedTracks.length > 0 && (
                  <>
                    <div className="player-captions-divider" />
                    <div className="player-captions-subheader">Embedded Tracks</div>
                    {embeddedTracks.map((track) => (
                      <button
                        key={track.id}
                        className={`player-captions-item ${activeSubtitleId === track.id ? 'active' : ''}`}
                        onClick={() => handleSelectSubtitle(track.id)}
                      >
                        <span className="player-captions-check">
                          {activeSubtitleId === track.id && <Check size={14} />}
                        </span>
                        <span className="player-captions-text">
                          {track.label}
                        </span>
                        <span className="player-captions-tag">Embedded</span>
                      </button>
                    ))}
                  </>
                )}

                {/* Custom Loaded Subtitles */}
                {externalSubtitles.filter((s) => !s.isAutoDetected).length > 0 && (
                  <>
                    <div className="player-captions-divider" />
                    <div className="player-captions-subheader">Loaded Subtitles</div>
                    {externalSubtitles.filter((s) => !s.isAutoDetected).map((sub) => (
                      <button
                        key={sub.id}
                        className={`player-captions-item ${activeSubtitleId === sub.id ? 'active' : ''}`}
                        onClick={() => handleSelectSubtitle(sub.id)}
                        title={sub.fileName}
                      >
                        <span className="player-captions-check">
                          {activeSubtitleId === sub.id && <Check size={14} />}
                        </span>
                        <span className="player-captions-text">
                          {sub.label}
                        </span>
                        <span className="player-captions-tag">Custom</span>
                      </button>
                    ))}
                  </>
                )}

                <div className="player-captions-divider" />

                {/* Choose file button */}
                <button
                  className="player-captions-item action"
                  onClick={handleLoadCustomSubtitle}
                >
                  <FileText size={14} style={{ marginRight: 6 }} />
                  <span>Choose subtitle file (.srt, .vtt)...</span>
                </button>
              </div>
            )}
          </div>

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

      <input
        type="file"
        ref={hiddenSubFileInputRef}
        accept=".srt,.vtt"
        style={{ display: 'none' }}
        onChange={handleBrowserSubtitleSelected}
      />
    </div>
  );
});

export default VideoPlayer;
