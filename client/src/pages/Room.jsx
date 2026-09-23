import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getRoom, getStreamStatus } from '../api/index.js';
import { useWebSocket, getSessionClientId } from '../hooks/useWebSocket.js';
import { useRoom } from '../hooks/useRoom.js';
import VideoPlayer from '../components/VideoPlayer.jsx';
import UserList from '../components/UserList.jsx';
import RoomInfo from '../components/RoomInfo.jsx';
import { ArrowLeft, Loader2, AlertTriangle, ShieldCheck, Crown } from 'lucide-react';

function getUserName() {
  let name = sessionStorage.getItem('wt_username');
  if (!name) {
    name = prompt('Enter your display name:', 'Host') || 'Host';
    name = name.trim() || 'Host';
    sessionStorage.setItem('wt_username', name);
  }
  return name;
}

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [userName] = useState(getUserName);
  const [myUserId] = useState(getSessionClientId);
  const [streamReady, setStreamReady] = useState(false);
  const [error, setError] = useState('');
  const [lastWsMsg, setLastWsMsg] = useState(null);
  const [toasts, setToasts] = useState([]);
  const pollRef = useRef(null);

  const [initialRoom, setInitialRoom] = useState(null);

  useEffect(() => {
    getRoom(roomId)
      .then(setInitialRoom)
      .catch(() => {
        setError('Session not found');
      });
  }, [roomId]);

  const { room, applyMessage } = useRoom(initialRoom);

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

      setLastWsMsg(msg);
      applyMessage(msg);
    },
    [applyMessage, myUserId]
  );

  const { connected, send } = useWebSocket(roomId, userName, handleMessage);

  useEffect(() => {
    if (streamReady) return;
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
  }, [roomId, streamReady]);

  function addToast(msg, type = 'info') {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000);
  }

  // Robust host detection
  const isHost = Boolean(
    (room?.hostId && room.hostId === myUserId) ||
    (room?.users?.find((u) => u.id === myUserId)?.isHost) ||
    (room?.users?.length === 1) ||
    (room?.users && !room.users.some((u) => u.isHost))
  );

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
        <button className="btn btn-secondary" onClick={() => navigate('/')}>
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

  // NAS-grade direct progressive streaming endpoint
  const videoSrc = streamReady ? `/api/rooms/${roomId}/video` : null;

  return (
    <div className="layout-room">
      <div className="room-main">
        <div className="room-header">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            <ArrowLeft size={18} />
          </button>
          <div style={{ flex: 1, marginLeft: 'var(--sp-4)', fontWeight: 500, fontSize: '0.875rem' }}>
            {room.movieName}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
              fontSize: '0.75rem',
              color: connected ? 'var(--success)' : 'var(--text-3)',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
            {connected ? 'Connected' : 'Connecting...'}
          </div>
        </div>

        <div className="player-container">
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

          <VideoPlayer
            src={videoSrc}
            isHost={isHost}
            wsMsg={lastWsMsg}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeek={handleSeek}
            onTimeUpdate={handleTimeUpdate}
          />
        </div>

        {/* Host status pill */}
        <div
          style={{
            position: 'absolute',
            top: 'var(--sp-4)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: isHost ? 'rgba(34, 197, 94, 0.15)' : 'rgba(0,0,0,0.7)',
            padding: 'var(--sp-2) var(--sp-4)',
            borderRadius: 'var(--r-full)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            zIndex: 10,
            backdropFilter: 'blur(6px)',
            border: `1px solid ${isHost ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255,255,255,0.1)'}`,
            pointerEvents: 'none',
          }}
        >
          {isHost ? (
            <>
              <Crown size={14} color="#22c55e" />
              <span style={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 500 }}>
                You are the host (Playback controls active)
              </span>
            </>
          ) : (
            <>
              <ShieldCheck size={14} color="var(--text-2)" />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>
                <strong style={{ color: 'var(--text-1)' }}>{hostName}</strong> controls playback
              </span>
            </>
          )}
        </div>
      </div>

      <div className="room-sidebar">
        <div className="sidebar-section" style={{ flex: 1, overflowY: 'auto' }}>
          <UserList users={room.users} hostId={room.hostId} currentUserId={myUserId} />
        </div>
        <div className="sidebar-section">
          <RoomInfo roomId={roomId} />
        </div>
      </div>

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
