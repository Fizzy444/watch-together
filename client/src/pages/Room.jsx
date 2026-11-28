import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { getServerUrl, DEFAULT_SERVER_URL } from '../utils/serverUrl.js';
import { useWebRTC } from '../hooks/useWebRTC.js';
import { useVoiceChat } from '../hooks/useVoiceChat.js';
import { getRoom, getStreamStatus, closeRoom } from '../api/index.js';
import { useWebSocket, getSessionClientId } from '../hooks/useWebSocket.js';
import { useRoom } from '../hooks/useRoom.js';
import { getProfileName, saveProfileName } from '../utils/profile.js';
import VideoPlayer from '../components/VideoPlayer.jsx';
import UserList from '../components/UserList.jsx';
import ChatBox from '../components/ChatBox.jsx';
import ProfileBadge from '../components/ProfileBadge.jsx';
import VoiceDock from '../components/VoiceDock.jsx';

const ProfileModal = lazy(() => import('../components/ProfileModal.jsx'));
const VoiceSettingsModal = lazy(() => import('../components/VoiceSettingsModal.jsx'));
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Crown,
  Shield,
  MessageSquare,
  Users,
  Link2,
  Check,
  Keyboard,
  X,
  Power,
  Zap,
  Upload,
  PanelRightClose,
  PanelRightOpen,
  PlaySquare,
  Film,
  Play,
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  PhoneCall,
  PhoneOff,
} from 'lucide-react';

function pushToast(setToasts, msg, type = 'info') {
  const id = Date.now() + Math.random();
  setToasts((prev) => [...prev, { id, msg, type }]);
  setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
}

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Local File & P2P Broadcast State
  const [localFile, setLocalFile] = useState(() => window.__wt_p2p_file || null);
  const [localStream, setLocalStream] = useState(null);
  const filePickerRef = useRef(null);

  const isHostNav = Boolean(location.state?.isHost);
  const isFromDashboard = Boolean(location.state?.fromDashboard);
  const storedName = getProfileName() || (isHostNav ? 'Host' : '');

  const [hasJoined, setHasJoined] = useState(() => {
    if ((isHostNav || isFromDashboard) && storedName) {
      return true;
    }
    return false;
  });

  const [userName, setUserName] = useState(() => (hasJoined ? storedName : ''));
  const [inputUserName, setInputUserName] = useState(storedName || '');
  const [joinError, setJoinError] = useState('');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [myUserId] = useState(getSessionClientId);

  const [streamReady, setStreamReady] = useState(false);
  const [hostLocalStreamUrl, setHostLocalStreamUrl] = useState(
    () => location.state?.localStreamUrl || window.__hostLocalStreamUrl || null
  );
  const [hostSubtitleUrl] = useState(
    () => location.state?.subtitleUrl || window.__hostSubtitleUrl || null
  );
  const [streamAudioTracks, setStreamAudioTracks] = useState(null);
  const [streamSubtitleTracks, setStreamSubtitleTracks] = useState(null);
  const [streamMovieDuration, setStreamMovieDuration] = useState(null);
  const [error, setError] = useState('');
    const [toasts, setToasts] = useState([]);
  const pollRef = useRef(null);

  // Clean Sidebar state: 'chat' | 'members'
  const [activeTab, setActiveTab] = useState('chat');
  const [unreadChat, setUnreadChat] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [copiedLink, setCopiedLink] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isRoomClosed, setIsRoomClosed] = useState(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState(false);

  const [initialRoom, setInitialRoom] = useState(null);

  useEffect(() => {
    getRoom(roomId)
      .then(setInitialRoom)
      .catch(() => {
        setError('Session not found');
      });
  }, [roomId]);

  const { room, applyMessage } = useRoom(initialRoom);

  const handleWebRTCMessageRef = useRef(null);
  const handleVoiceMessageRef = useRef(null);
  const videoPlayerRef = useRef(null);

  const isTunnelRef = useRef(false);
  const isHostRef = useRef(false);

  const handleMessage = useCallback(
    (msg) => {
      if (msg.type === 'user_joined' && msg.user.id !== myUserId) {
        addToast(`${msg.user.name} joined`);
      }
      if (msg.type === 'user_left' && msg.userId !== myUserId) {
        addToast(`${msg.userName || 'A user'} left`);
      }
      if (msg.type === 'host_changed') {
        addToast(`${msg.newHostName} is now the host`);
      }
      if (msg.type === 'admin_changed') {
        const targetLabel = msg.userId === myUserId ? 'You are' : `${msg.userName} is`;
        addToast(msg.isAdmin ? `${targetLabel} now an admin` : `${targetLabel} no longer an admin`);
      }
      if (msg.type === 'error') {
        addToast(msg.message, 'error');
      }
      if (msg.type === 'room_closed') {
        setIsRoomClosed({ message: msg.message || 'The host has ended this watch session.' });
        return;
      }

      // If a chat message arrives while on another tab or sidebar collapsed, show unread badge
      if (msg.type === 'chat') {
        if (!sidebarOpenRef.current || activeTabRef.current !== 'chat') {
          setUnreadChat((prev) => prev + 1);
        }
      }

      if (msg.type.startsWith("webrtc_") || msg.type === "host_changed") {
        handleWebRTCMessageRef.current?.(msg);
      }

      if (msg.type.startsWith("voice_") || msg.type === "user_left") {
        handleVoiceMessageRef.current?.(msg);
      }

      if (msg.type === 'seek' && isHostRef.current && isTunnelRef.current && msg.initiatorId !== myUserId) {
        window.desktopAPI?.seekHlsStream?.(msg.position).catch(() => {});
      }

      const isSelfSyncEcho = ['play', 'pause', 'seek'].includes(msg.type) && msg.initiatorId === myUserId;
      if (!isSelfSyncEcho && ['play', 'pause', 'seek', 'sync_tick', 'room_state'].includes(msg.type)) {
        videoPlayerRef.current?.handleSyncMessage(msg);
      }
            applyMessage(msg);
    },
    [applyMessage, myUserId]
  );

  const { connected, send } = useWebSocket(
    roomId,
    hasJoined ? userName : null,
    handleMessage
  );

  const isTunnel = Boolean(room?.streamType === 'tunnel' || (room?.movie && (room.movie.startsWith('http://') || room.movie.startsWith('https://'))));
  const isP2P = !isTunnel && Boolean(room?.streamType === 'p2p' || room?.movie === 'p2p-stream');
  const isTorrent = !isTunnel && Boolean(room?.streamType === 'torrent');

  // Precise host detection (User is host if navigation state says so, or matching hostId, creatorId, or user.isHost)
  const isHost = Boolean(
    location.state?.isHost ||
    (room && (
      (room.hostId && room.hostId === myUserId) ||
      (room.creatorId && room.creatorId === myUserId) ||
      (room.users && room.users.find((u) => u.id === myUserId)?.isHost)
    ))
  );
  const isAdmin = !isHost && Boolean(room?.users?.find((u) => u.id === myUserId)?.isAdmin);
  const canControl = isHost || isAdmin;
  isHostRef.current = isHost;
  isTunnelRef.current = isTunnel;

  // WebRTC Peer-to-Peer Engine
  const {
    remoteStream,
    connectionState,
    connectedViewersCount,
    handleWebRTCMessage
  } = useWebRTC({
    isHost,
    isP2P,
    localStream,
    send,
    hostId: room?.hostId,
    myUserId,
    connected,
  });

  useEffect(() => {
    handleWebRTCMessageRef.current = handleWebRTCMessage;
  }, [handleWebRTCMessage]);

  const voice = useVoiceChat({
    roomUsers: room?.users || [],
    myUserId,
    connected,
    send,
  });
  const {
    handleVoiceMessage,
    voiceError,
    clearVoiceError,
    leaveVoice,
  } = voice;

  useEffect(() => {
    handleVoiceMessageRef.current = handleVoiceMessage;
  }, [handleVoiceMessage]);

  useEffect(() => {
    if (voiceError) {
      pushToast(setToasts, voiceError, 'error');
      clearVoiceError();
    }
  }, [voiceError, clearVoiceError]);

  const localBlobUrl = useMemo(() => {
    if (!localFile) return null;
    return URL.createObjectURL(localFile);
  }, [localFile]);

  useEffect(() => {
    return () => {
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
    };
  }, [localBlobUrl]);

  // Cleanup host tunnel when window is closed or refreshed (NOT on component unmount to prevent React StrictMode premature kill)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (isHost && isTunnel) {
        window.electronAPI?.stopHostTunnel?.();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isHost, isTunnel]);

  useEffect(() => {
    const unsubscribe = window.desktopAPI?.onTunnelStatus?.((status) => {
      if (status?.step === 'error' && status.message) {
        pushToast(setToasts, status.message, 'error');
      }
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (streamReady) return;
    if (isP2P || isTorrent || isTunnel) {
      setStreamReady(true);
      return;
    }
    const check = async () => {
      const status = await getStreamStatus(roomId).catch(() => ({ ready: false }));
      if (status.ready) {
        setStreamReady(true);
        if (status.audioTracks) setStreamAudioTracks(status.audioTracks);
        if (status.subtitleTracks) setStreamSubtitleTracks(status.subtitleTracks);
        if (status.movieDuration) setStreamMovieDuration(status.movieDuration);
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    check();
    pollRef.current = setInterval(check, 2000);
    return () => clearInterval(pollRef.current);
  }, [roomId, streamReady, isP2P, isTorrent, isTunnel]);

  function addToast(msg, type = 'info') {
    pushToast(setToasts, msg, type);
  }

  function handleVideoPlaybackError(error, failedSrc) {
    if (!isHost || !isTunnel || !hostLocalStreamUrl || failedSrc !== hostLocalStreamUrl) return;
    setHostLocalStreamUrl(null);
    window.__hostLocalStreamUrl = null;
    addToast('Local stream failed; switched to the tunnel URL.', 'info');
  }

  const handleLeaveRoom = useCallback(() => {
    leaveVoice();
    if (isHost && isTunnel) {
      window.electronAPI?.stopHostTunnel?.();
      window.__hostLocalStreamUrl = null;
      window.__hostSubtitleUrl = null;
    }
    navigate('/dashboard');
  }, [isHost, isTunnel, navigate, leaveVoice]);

  // Auto-redirect if room was closed
  useEffect(() => {
    if (!isRoomClosed) return;
    const timer = setTimeout(() => {
      handleLeaveRoom();
    }, 3500);
    return () => clearTimeout(timer);
  }, [isRoomClosed, handleLeaveRoom]);

  async function handleCloseRoom() {
    setClosing(true);
    try {
      voice.leaveVoice();
      if (isTunnel) {
        window.electronAPI?.stopHostTunnel?.();
      }
      send('close_room', {});
      await closeRoom(roomId, myUserId).catch(() => {});
      addToast('Room closed');
      navigate('/dashboard');
    } catch (err) {
      console.error('Failed to close room:', err);
      navigate('/dashboard');
    } finally {
      setClosing(false);
      setShowCloseConfirm(false);
    }
  }

  function handleJoinSession(e) {
    e.preventDefault();
    const trimmed = inputUserName.trim();
    if (!trimmed) {
      setJoinError('Please enter a username to join');
      return;
    }
    saveProfileName(trimmed);
    setUserName(trimmed);
    setHasJoined(true);
    setJoinError('');
  }

  function handleProfileSave(newName) {
    saveProfileName(newName);
    setUserName(newName);
    // Broadcast name change to room peers
    send('update_name', { name: newName });
    addToast(`Display name set to ${newName}`);
  }

  async function copyRoomLink() {
    const serverUrl = getServerUrl() || DEFAULT_SERVER_URL;
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.protocol === "file:" || window.location.hostname === "tauri.localhost";
    const baseUrl = (isLocal && serverUrl) ? serverUrl : window.location.origin;
    const url = `${baseUrl}/watch/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedLink(true);
    addToast('Room link copied to clipboard');
    setTimeout(() => setCopiedLink(false), 2000);
  }

// Host state already computed above

  const handlePlay = useCallback(
    (position) => {
      send('play', { position, serverTime: Date.now() });
      applyMessage({ type: 'play', position });
    },
    [send, applyMessage]
  );

  const handlePause = useCallback(
    (position) => {
      send('pause', { position });
      applyMessage({ type: 'pause', position });
    },
    [send, applyMessage]
  );

  const handleSeek = useCallback(
    (position) => {
      if (isHost) {
        window.desktopAPI?.seekHlsStream?.(position).catch(() => {});
      }
      send('seek', { position });
      applyMessage({ type: 'seek', position });
    },
    [isHost, send, applyMessage]
  );

  const lastTimeUpdateSentRef = useRef(0);
  const handleTimeUpdate = useCallback(
    (position) => {
      const now = Date.now();
      if (now - lastTimeUpdateSentRef.current >= 2000) {
        lastTimeUpdateSentRef.current = now;
        send('time_update', { position });
      }
    },
    [send]
  );

  const handleToggleAdmin = useCallback(
    (targetUserId, nextIsAdmin) => {
      if (!isHost) return;
      send('set_admin', { targetUserId, isAdmin: nextIsAdmin });
    },
    [isHost, send]
  );

  const handleSendMessage = useCallback(
    (text) => {
      send('chat', { text });
    },
    [send]
  );

  function handleTabSelect(tab) {
    setActiveTab(tab);
    if (tab === 'chat') {
      setUnreadChat(0);
    }
  }

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      if (next && activeTabRef.current === 'chat') {
        setUnreadChat(0);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    function onKeyDown(e) {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if ((e.key === 'c' || e.key === 'C') && e.shiftKey) {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleSidebar]);

  const p2pStatus = useMemo(
    () => ({ connectionState, viewersCount: connectedViewersCount }),
    [connectionState, connectedViewersCount]
  );

  const handleStreamReady = useMemo(
    () => (isP2P && isHost ? setLocalStream : null),
    [isP2P, isHost]
  );

  const resolvedSubtitleTracks =
    location?.state?.subtitleTracks ||
    window.__hostSubtitleTracks ||
    room?.subtitleTracks ||
    streamSubtitleTracks ||
    null;

  const resolvedAudioTracks =
    window.__hostAudioTracks ||
    location?.state?.audioTracks ||
    room?.audioTracks ||
    streamAudioTracks ||
    null;

  const resolvedDuration =
    location?.state?.movieDuration ||
    window.__hostMovieDuration ||
    room?.movieDuration ||
    streamMovieDuration ||
    null;

  if (error) {
    return (
      <div
        className="container"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
        }}
      >
        <AlertTriangle size={48} color="var(--error)" style={{ marginBottom: 'var(--sp-4)' }} />
        <h2 style={{ marginBottom: 'var(--sp-2)' }}>{error}</h2>
        <p style={{ marginBottom: 'var(--sp-6)' }}>The session may have ended or the URL is invalid.</p>
        <button className="btn btn-secondary" onClick={handleLeaveRoom}>
          Return to Library
        </button>
      </div>
    );
  }

  if (!room) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          color: 'var(--text-3)',
        }}
      >
        <Loader2 className="spinner" size={24} style={{ marginRight: 'var(--sp-3)' }} />
        <span>Loading session...</span>
      </div>
    );
  }

  if (!hasJoined) {
    const movieOrRoomName = room.name || room.movieName || 'Watch Session';
    const hostUser = room.users?.find((u) => u.isHost || u.id === room.hostId);
    const hostName = hostUser?.name || room.hostName || '';

    return (
      <div className="room-join-screen">
        <div className="room-join-card">
          <div className="room-join-header">
            <div className="room-join-icon">
              <PlaySquare size={28} color="#fff" />
            </div>
            <div className="room-join-badge">
              <Film size={13} />
              <span>{movieOrRoomName}</span>
            </div>
            <h2 className="room-join-title">Join Watch Session</h2>
            <p className="room-join-subtitle">
              {hostName ? `${hostName} invited you to watch together.` : 'Enter your username to start watching.'}
            </p>
          </div>

          <form onSubmit={handleJoinSession} className="room-join-form">
            <div className="room-join-input-wrap">
              <label htmlFor="join-username-input" className="room-join-label">
                Username
              </label>
              <input
                id="join-username-input"
                type="text"
                className="input room-join-input"
                placeholder="Enter your username..."
                value={inputUserName}
                onChange={(e) => {
                  setInputUserName(e.target.value);
                  if (joinError) setJoinError('');
                }}
                autoFocus
                maxLength={32}
              />
            </div>

            {joinError && (
              <div className="room-join-error">
                {joinError}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary room-join-btn"
              disabled={!inputUserName.trim()}
            >
              <Play size={16} fill="currentColor" />
              <span>Join Session</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Direct progressive streaming endpoint
  const serverUrl = getServerUrl() || DEFAULT_SERVER_URL;
  const videoSrc = isTunnel
    ? ((isHost && hostLocalStreamUrl) ? hostLocalStreamUrl : room.movie)
    : (isP2P
        ? null
        : (streamReady
            ? `${serverUrl}/api/rooms/${roomId}/stream/index.m3u8`
            : null));

  return (
    <div className="room-page-wrapper">
      {/* Dedicated Top Bar for Room: Extra space, invite link, stop room button */}
      <header className="room-topbar">
        <div className="room-topbar-left">
          <button
            className="btn btn-ghost btn-sm room-topbar-back"
            onClick={handleLeaveRoom}
            title="Return to Dashboard"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="room-topbar-titles">
            <span className="room-topbar-title">
              {room.name || room.movieName}
            </span>
            {room.name && room.name !== room.movieName && (
              <span className="room-topbar-subtitle">
                ({room.movieName})
              </span>
            )}
          </div>

          <div className="room-topbar-status">
            <span
              className="room-topbar-status-dot"
              style={{ background: connected ? 'var(--success)' : 'var(--text-3)' }}
            />
            <span className="room-topbar-status-text">
              {connected ? 'Connected' : 'Connecting...'}
            </span>
          </div>

          {isHost ? (
            <span className="badge badge-host badge-compact room-topbar-role-badge">
              <Crown size={11} />
              <span>Host</span>
            </span>
          ) : isAdmin ? (
            <span className="badge badge-info badge-compact room-topbar-role-badge">
              <Shield size={11} />
              <span>Admin</span>
            </span>
          ) : (
            <span className="badge badge-compact room-topbar-role-badge" style={{ color: 'var(--text-3)' }}>
              Viewer
            </span>
          )}

          {isP2P && (
            <span className="badge badge-warning badge-compact room-topbar-role-badge">
              <Zap size={11} />
              <span>P2P</span>
            </span>
          )}
          {isTorrent && (
            <span className="badge badge-info badge-compact room-topbar-role-badge">
              <Zap size={11} />
              <span>Torrent</span>
            </span>
          )}
        </div>

        <div className="room-topbar-right">
          {/* Quick Voice Controls (Cinema Mode & Mobile; desktop sidebar already shows VoiceDock) */}
          {!voice.isInVoice ? (
            <button
              type="button"
              className={`btn btn-secondary btn-sm room-topbar-btn voice-topbar-join-btn ${sidebarOpen ? 'is-sidebar-open' : ''}`}
              onClick={voice.joinVoice}
              disabled={voice.isJoining || !connected}
              title="Join Voice Chat"
              aria-label="Join voice chat"
            >
              {voice.isJoining ? <Loader2 size={14} className="spinner" /> : <PhoneCall size={14} />}
              <span className="room-topbar-btn-label">{voice.isJoining ? 'Joining...' : 'Voice'}</span>
            </button>
          ) : (
            <div className="voice-topbar-group">
              <button
                type="button"
                className={`btn btn-sm room-topbar-btn voice-topbar-btn ${voice.isMuted || voice.isDeafened ? 'is-danger' : voice.isTalking ? 'is-talking' : ''}`}
                onClick={voice.toggleMute}
                title={voice.isMuted || voice.isDeafened ? 'Unmute Mic (Shift+M)' : 'Mute Mic (Shift+M)'}
                aria-label={voice.isMuted || voice.isDeafened ? 'Unmute microphone' : 'Mute microphone'}
              >
                {voice.isMuted || voice.isDeafened ? <MicOff size={14} /> : <Mic size={14} />}
              </button>
              <button
                type="button"
                className={`btn btn-sm room-topbar-btn voice-topbar-btn ${voice.isDeafened ? 'is-danger' : ''}`}
                onClick={voice.toggleDeafen}
                title={voice.isDeafened ? 'Undeafen (Shift+D)' : 'Deafen (Shift+D)'}
                aria-label={voice.isDeafened ? 'Undeafen' : 'Deafen'}
              >
                {voice.isDeafened ? <HeadphoneOff size={14} /> : <Headphones size={14} />}
              </button>
              {!sidebarOpen && (
                <button
                  type="button"
                  className="btn btn-sm room-topbar-btn voice-topbar-btn voice-topbar-leave"
                  onClick={voice.leaveVoice}
                  title="Leave Voice Chat"
                  aria-label="Leave voice chat"
                >
                  <PhoneOff size={14} />
                </button>
              )}
            </div>
          )}

          {/* Profile Badge with dropdown */}
          {userName && (
            <div className="room-topbar-profile">
              <ProfileBadge
                name={userName}
                onEdit={() => setIsProfileModalOpen(true)}
                onClear={() => {
                  setUserName('');
                  setHasJoined(false);
                }}
              />
            </div>
          )}

          {/* Invite Link Button */}
          <button
            type="button"
            className="btn btn-secondary btn-sm room-topbar-btn"
            onClick={copyRoomLink}
            title={copiedLink ? 'Link copied to clipboard!' : 'Copy room invite link'}
            aria-label="Copy invite link"
          >
            {copiedLink ? <Check size={14} color="var(--success)" /> : <Link2 size={14} />}
            <span className="room-topbar-btn-label">{copiedLink ? 'Copied!' : 'Invite'}</span>
          </button>

          {/* Toggle Sidebar Button (Cinema Mode) */}
          <button
            type="button"
            className={`btn btn-sm room-topbar-btn room-topbar-sidebar-toggle ${sidebarOpen ? "btn-ghost" : "btn-secondary"}`}
            onClick={toggleSidebar}
            title={sidebarOpen ? 'Collapse sidebar (Cinema Mode)' : 'Show Chat & Members'}
            aria-label={sidebarOpen ? 'Hide chat' : 'Show chat'}
          >
            {sidebarOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
            <span className="room-topbar-btn-label">{sidebarOpen ? 'Hide Chat' : 'Chat'}</span>
            {!sidebarOpen && unreadChat > 0 && (
              <span className="room-topbar-badge">{unreadChat}</span>
            )}
          </button>

          {/* Stop Room (Host) or Leave Room */}
          {isHost ? (
            <button
              type="button"
              className="btn btn-danger-soft btn-sm room-topbar-btn room-topbar-stop-btn"
              onClick={() => setShowCloseConfirm(true)}
              title="Close room for everyone"
              aria-label="Stop room"
            >
              <Power size={14} />
              <span className="room-topbar-btn-label">Stop Room</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm room-topbar-btn"
              onClick={handleLeaveRoom}
              title="Leave Room"
              aria-label="Leave room"
            >
              <ArrowLeft size={14} />
              <span className="room-topbar-btn-label">Leave</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Watch Layout (Video Canvas + Chat Sidebar) */}
      <div className="layout-room">
        <div className="room-main">
          {/* Video Player Container */}
          <div className="player-container" style={{ position: "relative" }}>
            {!streamReady && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  color: 'var(--text-2)',
                  zIndex: 5,
                }}
              >
                <Loader2 className="spinner" size={32} style={{ marginBottom: 'var(--sp-4)' }} />
                <p style={{ fontSize: '0.875rem' }}>Initializing stream...</p>
              </div>
            )}

            {/* Host Local File Picker Overlay (if host reloaded or needs to pick file) */}
            {isP2P && isHost && !localFile && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 25,
                  background: "var(--bg-card)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "var(--sp-6)",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: "rgba(234, 179, 8, 0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "var(--sp-4)",
                  }}
                >
                  <Zap size={28} color="#eab308" />
                </div>
                <h3 style={{ fontSize: "1.25rem", marginBottom: "8px", color: "var(--text-1)" }}>
                  Select Local Video to Broadcast
                </h3>
                <p style={{ color: "var(--text-2)", maxWidth: 420, fontSize: "0.875rem", marginBottom: "var(--sp-5)", lineHeight: 1.5 }}>
                  Choose the video file ({room.movieName || room.name}) from your device to begin direct peer-to-peer streaming to room viewers.
                </p>
                <input
                  type="file"
                  ref={filePickerRef}
                  accept=".mp4,.mkv,.webm,.mov,.avi"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setLocalFile(file);
                  }}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => filePickerRef.current?.click()}
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <Upload size={16} /> Choose File & Begin Broadcast
                </button>
              </div>
            )}

            <VideoPlayer
              ref={videoPlayerRef}
              src={videoSrc}
              subtitleUrl={hostSubtitleUrl || room?.subtitleUrl || null}
              subtitleTracks={resolvedSubtitleTracks}
              onPlaybackError={handleVideoPlaybackError}
              streamObject={isP2P && !isHost ? remoteStream : null}
              isP2P={isP2P}
              isTorrent={isTorrent}
              torrentMagnet={isTorrent ? room.movie : null}
              p2pStatus={p2pStatus}
              onStreamReady={handleStreamReady}
              isHost={isHost}
              canControl={canControl}
              initialTime={room?.currentTime || 0}
              initialPlaying={room?.playing || false}
              wasPlayingBeforeDisconnect={Boolean(room?.wasPlayingBeforeHostDisconnect || room?.hostDisconnected)}
              videoPath={window.__hostFilePath || null}
              audioTracks={resolvedAudioTracks}
              knownDuration={resolvedDuration}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeek={handleSeek}
              onTimeUpdate={handleTimeUpdate}
            />
          </div>
        </div>

        {/* Clean Right Sidebar */}
        <div className={`room-sidebar clean-sidebar ${sidebarOpen ? "" : "collapsed"}`}>
          {/* Clean Segmented Header Tabs */}
          <div className="clean-sidebar-header">
            <div className="sidebar-tabs" style={{ border: 'none', background: 'transparent', flex: 1, padding: 0 }}>
              <button
                className={`sidebar-tab ${activeTab === 'chat' ? 'active' : ''}`}
                onClick={() => handleTabSelect('chat')}
              >
                <MessageSquare size={13} />
                <span>Chat</span>
                {unreadChat > 0 && activeTab !== 'chat' && (
                  <span
                    style={{
                      background: 'var(--primary)',
                      color: 'var(--primary-text)',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      borderRadius: 'var(--r-full)',
                      padding: '0 5px',
                      height: 16,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {unreadChat}
                  </span>
                )}
              </button>

              <button
                className={`sidebar-tab ${activeTab === 'members' ? 'active' : ''}`}
                onClick={() => handleTabSelect('members')}
              >
                <Users size={13} />
                <span>Members</span>
                <span className="sidebar-tab-badge">{room.users?.length || 0}</span>
              </button>
            </div>

            <button
              className="sidebar-action-btn sidebar-collapse-btn"
              onClick={() => setSidebarOpen(false)}
              title="Collapse sidebar (Cinema Mode)"
            >
              <PanelRightClose size={13} />
            </button>
            <button
              className="sidebar-action-btn sidebar-shortcuts-btn"
              onClick={() => setShowShortcuts((v) => !v)}
              title="Keyboard shortcuts"
            >
              <Keyboard size={14} />
            </button>
          </div>

          {/* Clean Sidebar Content Body */}
          <div className="clean-sidebar-body">
            {activeTab === 'chat' ? (
              <ChatBox
                messages={room.messages || []}
                onSendMessage={handleSendMessage}
                currentUserId={myUserId}
                hostId={room.hostId}
              />
            ) : (
              <div style={{ padding: '8px 10px', flex: 1, overflowY: 'auto' }}>
                <UserList
                  users={room.users}
                  hostId={room.hostId}
                  currentUserId={myUserId}
                  canManageAdmins={isHost}
                  onToggleAdmin={handleToggleAdmin}
                  speakingPeers={voice.speakingPeers}
                  isTalking={voice.isTalking}
                  isInVoice={voice.isInVoice}
                  isMuted={voice.isMuted}
                  isDeafened={voice.isDeafened}
                />
              </div>
            )}
          </div>

          <VoiceDock
            users={room.users || []}
            myUserId={myUserId}
            isInVoice={voice.isInVoice}
            isJoining={voice.isJoining}
            isMuted={voice.isMuted}
            isDeafened={voice.isDeafened}
            isTalking={voice.isTalking}
            micLevel={voice.micLevel}
            speakingPeers={voice.speakingPeers}
            peerVolumes={voice.peerVolumes}
            locallyMutedPeers={voice.locallyMutedPeers}
            activeNoiseMode={voice.activeNoiseMode}
            inputMode={voice.voiceSettings.inputMode}
            isPttPressed={voice.isPttPressed}
            onSetPttPressed={voice.setIsPttPressed}
            onJoinVoice={voice.joinVoice}
            onLeaveVoice={voice.leaveVoice}
            onToggleMute={voice.toggleMute}
            onToggleDeafen={voice.toggleDeafen}
            onSetPeerVolume={voice.setPeerVolume}
            onToggleLocalPeerMute={voice.toggleLocalPeerMute}
            onOpenSettings={() => setIsVoiceSettingsOpen(true)}
          />
        </div>
      </div>

      {/* Keyboard Shortcuts Popover Modal */}
      {showShortcuts && (
        <div className="modal-backdrop" onClick={() => setShowShortcuts(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: 360 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <Keyboard size={16} />
                <h3 style={{ fontSize: '0.9375rem', margin: 0 }}>Shortcuts</h3>
              </div>
              <button className="btn-icon" onClick={() => setShowShortcuts(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body shortcuts-list">
              {[
                { key: 'Shift + C', desc: 'Toggle Chat Sidebar' },
                { key: 'Shift + M', desc: 'Mute / Unmute Voice Mic' },
                { key: 'Shift + D', desc: 'Deafen / Undeafen Voice' },
                { key: 'V (Hold)', desc: 'Push to talk (when enabled)' },
                { key: 'C', desc: 'Toggle Subtitles' },
                { key: 'B', desc: 'Cycle Audio Language' },
                { key: 'Space / K', desc: 'Play / Pause (Host)' },
                { key: '← / →', desc: 'Skip 5s (Host)' },
                { key: 'J / L', desc: 'Skip 10s (Host)' },
                { key: '↑ / ↓', desc: 'Volume' },
                { key: 'M', desc: 'Mute / Unmute Video' },
                { key: 'F', desc: 'Toggle Fullscreen' },
              ].map((s) => (
                <div key={s.key} className="shortcut-row">
                  <kbd className="shortcut-kbd">{s.key}</kbd>
                  <span style={{ color: 'var(--text-2)' }}>{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        {isProfileModalOpen && (
          <ProfileModal
            isOpen={isProfileModalOpen}
            onClose={() => setIsProfileModalOpen(false)}
            currentName={userName}
            onSave={handleProfileSave}
          />
        )}
        {isVoiceSettingsOpen && (
          <VoiceSettingsModal
            isOpen={isVoiceSettingsOpen}
            onClose={() => setIsVoiceSettingsOpen(false)}
            voiceSettings={voice.voiceSettings}
            audioDevices={voice.audioDevices}
            isInVoice={voice.isInVoice}
            micLevel={voice.micLevel}
            onUpdateSettings={voice.updateVoiceSettings}
          />
        )}
      </Suspense>

      {/* Close Room Confirmation Modal */}
      {showCloseConfirm && (
        <div className="modal-backdrop" onClick={() => !closing && setShowCloseConfirm(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: 400 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <AlertTriangle size={18} color="var(--error)" />
                <h3 style={{ fontSize: '0.9375rem', margin: 0 }}>Close Watch Session?</h3>
              </div>
              <button
                className="btn-icon"
                onClick={() => setShowCloseConfirm(false)}
                disabled={closing}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body" style={{ padding: 'var(--sp-4)' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.5, margin: 0 }}>
                Are you sure you want to end this room? All connected members will be disconnected and this room will be removed.
              </p>
            </div>

            <div
              className="modal-footer"
              style={{
                padding: 'var(--sp-3) var(--sp-4)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 'var(--sp-2)',
                borderTop: '1px solid var(--border)',
              }}
            >
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setShowCloseConfirm(false)}
                disabled={closing}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={handleCloseRoom}
                disabled={closing}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              >
                {closing ? <Loader2 className="spinner" size={13} /> : <Power size={13} />}
                <span>{closing ? 'Closing...' : 'Close Room'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Room Closed Overlay */}
      {isRoomClosed && (
        <div className="modal-backdrop" style={{ zIndex: 1000, background: 'rgba(0, 0, 0, 0.88)' }}>
          <div
            className="modal-content"
            style={{ maxWidth: 400, textAlign: 'center', padding: 'var(--sp-6)' }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.12)',
                color: 'var(--error)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto var(--sp-4)',
              }}
            >
              <Power size={22} />
            </div>
            <h3 style={{ fontSize: '1.0625rem', marginBottom: 'var(--sp-2)' }}>Session Ended</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', marginBottom: 'var(--sp-6)', lineHeight: 1.5 }}>
              {isRoomClosed.message}
            </p>
            <button
              className="btn btn-primary"
              onClick={handleLeaveRoom}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Return to Home
            </button>
          </div>
        </div>
      )}

      {/* Floating Notifications */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast"
            style={{ borderColor: t.type === 'error' ? 'var(--error)' : 'var(--border)' }}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
