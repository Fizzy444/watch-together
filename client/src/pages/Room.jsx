import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useWebRTC } from '../hooks/useWebRTC.js';
import { getRoom, getStreamStatus, closeRoom } from '../api/index.js';
import { useWebSocket, getSessionClientId } from '../hooks/useWebSocket.js';
import { useRoom } from '../hooks/useRoom.js';
import { getProfileName, saveProfileName } from '../utils/profile.js';
import VideoPlayer from '../components/VideoPlayer.jsx';
import UserList from '../components/UserList.jsx';
import ChatBox from '../components/ChatBox.jsx';
import ProfileModal from '../components/ProfileModal.jsx';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Crown,
  MessageSquare,
  Users,
  Link2,
  Check,
  Keyboard,
  X,
  Power,
  Zap,
  Globe,
  Upload,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Local File & P2P Broadcast State
  const [localFile, setLocalFile] = useState(() => window.__wt_p2p_file || null);
  const [localStream, setLocalStream] = useState(null);
  const filePickerRef = useRef(null);

  // Profile state — NO default 'Host' or 'Guest' name!
  const [userName, setUserName] = useState(getProfileName);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(!getProfileName());
  const [myUserId] = useState(getSessionClientId);

  const [streamReady, setStreamReady] = useState(false);
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
  const videoPlayerRef = useRef(null);

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
      // Route playback sync messages to VideoPlayer
      if (['play', 'pause', 'seek', 'sync_tick', 'room_state'].includes(msg.type)) {
        videoPlayerRef.current?.handleSyncMessage(msg);
      }
            applyMessage(msg);
    },
    [applyMessage, myUserId]
  );

  // Only connect WebSocket once user has set their name
  const { connected, send } = useWebSocket(
    roomId,
    userName || 'Guest',
    handleMessage
  );

  const isTunnel = Boolean(room?.streamType === 'tunnel' || (room?.movie && (room.movie.startsWith('http://') || room.movie.startsWith('https://'))));
  const isP2P = !isTunnel && Boolean(room?.streamType === 'p2p' || room?.movie === 'p2p-stream');
  const isTorrent = !isTunnel && Boolean(room?.streamType === 'torrent');

  // Precise host detection (User is host ONLY if matching hostId, creatorId, or user.isHost)
  const isHost = Boolean(
    room && (
      (room.hostId && room.hostId === myUserId) ||
      (room.creatorId && room.creatorId === myUserId) ||
      (room.users && room.users.find((u) => u.id === myUserId)?.isHost)
    )
  );

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

  // Stop host tunnel ONLY when navigating away from the room page completely
  useEffect(() => {
    return () => {
      window.electronAPI?.stopHostTunnel?.();
    };
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
        if (pollRef.current) clearInterval(pollRef.current);
      }
    };
    check();
    pollRef.current = setInterval(check, 2000);
    return () => clearInterval(pollRef.current);
  }, [roomId, streamReady, isP2P, isTorrent, isTunnel]);

  function addToast(msg, type = 'info') {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }

  // Auto-redirect if room was closed
  useEffect(() => {
    if (!isRoomClosed) return;
    const timer = setTimeout(() => {
      navigate('/dashboard');
    }, 3500);
    return () => clearTimeout(timer);
  }, [isRoomClosed, navigate]);

  async function handleCloseRoom() {
    setClosing(true);
    try {
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

  function handleProfileSave(newName) {
    saveProfileName(newName);
    setUserName(newName);
    // Broadcast name change to room peers
    send('update_name', { name: newName });
    addToast(`Display name set to ${newName}`);
  }

  async function copyRoomLink() {
    const serverUrl = import.meta.env.VITE_SERVER_URL ? import.meta.env.VITE_SERVER_URL.replace(/\/+$/, "") : "";
    const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.protocol === "file:";
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

  const hostUser = room?.users?.find((u) => u.isHost || u.id === room?.hostId);
  const hostName = hostUser?.name || 'Host';

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
      send('seek', { position });
      applyMessage({ type: 'seek', position });
    },
    [send, applyMessage]
  );

  const handleTimeUpdate = useCallback(
    (position) => {
      send('time_update', { position });
    },
    [send]
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

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      const next = !prev;
      if (next && activeTab === 'chat') {
        setUnreadChat(0);
      }
      return next;
    });
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTab]);

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
        <button className="btn btn-secondary" onClick={() => navigate('/dashboard')}>
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

  // Direct progressive streaming endpoint
  const serverUrl = import.meta.env.VITE_SERVER_URL ? import.meta.env.VITE_SERVER_URL.replace(/\/+$/, "") : "";
  const videoSrc = isTunnel ? ((isHost && window.__hostLocalStreamUrl) ? window.__hostLocalStreamUrl : room.movie) : (streamReady ? `${serverUrl}/api/rooms/${roomId}/video` : null);

  return (
    <div className="room-page-wrapper">
      {/* Dedicated Top Bar for Room: Extra space, invite link, stop room button */}
      <header className="room-topbar">
        <div className="room-topbar-left">
          <button
            className="btn btn-ghost btn-sm room-topbar-back"
            onClick={() => navigate('/dashboard')}
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
            <span
              className="badge badge-host"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', fontSize: '0.6875rem' }}
            >
              <Crown size={11} />
              Host
            </span>
          ) : (
            <span className="badge" style={{ padding: '2px 7px', fontSize: '0.6875rem', color: 'var(--text-3)' }}>
              Viewer
            </span>
          )}

          {isP2P && (
            <span
              className="badge"
              style={{
                background: "rgba(234, 179, 8, 0.12)",
                color: "#eab308",
                border: "1px solid rgba(234, 179, 8, 0.3)",
                padding: "2px 7px",
                fontSize: "0.6875rem",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Zap size={11} />
              P2P WebRTC
            </span>
          )}
          {isTorrent && (
            <span
              className="badge"
              style={{
                background: "rgba(59, 130, 246, 0.12)",
                color: "#3b82f6",
                border: "1px solid rgba(59, 130, 246, 0.3)",
                padding: "2px 7px",
                fontSize: "0.6875rem",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Zap size={11} />
              WebTorrent
            </span>
          )}
        </div>

        <div className="room-topbar-right">
          {/* Invite Link Button */}
          <button
            className="btn btn-secondary btn-sm room-topbar-btn"
            onClick={copyRoomLink}
            title={copiedLink ? 'Link copied to clipboard!' : 'Copy room invite link'}
          >
            {copiedLink ? <Check size={14} color="var(--success)" /> : <Link2 size={14} />}
            <span>{copiedLink ? 'Copied!' : 'Invite Link'}</span>
          </button>

          {/* Toggle Sidebar Button (Cinema Mode) */}
          <button
            className={`btn btn-sm room-topbar-btn ${sidebarOpen ? "btn-ghost" : "btn-secondary"}`}
            onClick={toggleSidebar}
            title={sidebarOpen ? 'Collapse sidebar (Cinema Mode)' : 'Show Chat & Members'}
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
              className="btn btn-danger-soft btn-sm room-topbar-btn room-topbar-stop-btn"
              onClick={() => setShowCloseConfirm(true)}
              title="Close room for everyone"
            >
              <Power size={14} />
              <span>Stop Room</span>
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-sm room-topbar-btn"
              onClick={() => navigate('/dashboard')}
              title="Leave Room"
            >
              <ArrowLeft size={14} />
              <span>Leave</span>
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
              streamObject={isP2P && !isHost ? remoteStream : null}
              isP2P={isP2P}
              isTorrent={isTorrent}
              torrentMagnet={isTorrent ? room.movie : null}
              p2pStatus={{ connectionState, viewersCount: connectedViewersCount }}
              onStreamReady={isP2P && isHost ? setLocalStream : null}
              isHost={isHost}
              initialTime={room?.currentTime || 0}
              initialPlaying={room?.playing || false}
              wasPlayingBeforeDisconnect={Boolean(room?.wasPlayingBeforeHostDisconnect || room?.hostDisconnected)}
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
                <UserList users={room.users} hostId={room.hostId} currentUserId={myUserId} />
              </div>
            )}
          </div>
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
            <div className="modal-body" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-2)' }}>
              {[
                { key: 'C', desc: 'Toggle Sidebar / Cinema Mode' },
                { key: 'Space / K', desc: 'Play / Pause (Host)' },
                { key: '← / →', desc: 'Skip 5s (Host)' },
                { key: 'J / L', desc: 'Skip 10s (Host)' },
                { key: '↑ / ↓', desc: 'Volume' },
                { key: 'M', desc: 'Mute / Unmute' },
                { key: 'F', desc: 'Toggle Fullscreen' },
              ].map((s) => (
                <div
                  key={s.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.8125rem',
                  }}
                >
                  <kbd
                    style={{
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)',
                      padding: '2px 6px',
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      color: 'var(--text-1)',
                    }}
                  >
                    {s.key}
                  </kbd>
                  <span style={{ color: 'var(--text-2)' }}>{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Profile Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        currentName={userName}
        onSave={handleProfileSave}
        isMandatory={!userName}
      />

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
              onClick={() => navigate('/dashboard')}
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
