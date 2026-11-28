import { useState, memo } from 'react';
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  PhoneCall,
  PhoneOff,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Sparkles,
  Loader2,
  Radio,
} from 'lucide-react';

function getNoiseBadgeLabel(mode) {
  if (mode === 'rnnoise') return 'RNNoise AI';
  if (mode === 'browser') return 'Standard NS';
  return 'Raw Audio';
}

function VoiceDock({
  users = [],
  myUserId,
  isInVoice,
  isJoining,
  isMuted,
  isDeafened,
  isTalking,
  micLevel,
  speakingPeers,
  peerVolumes,
  locallyMutedPeers,
  activeNoiseMode,
  inputMode,
  isPttPressed,
  onSetPttPressed,
  onJoinVoice,
  onLeaveVoice,
  onToggleMute,
  onToggleDeafen,
  onSetPeerVolume,
  onToggleLocalPeerMute,
  onOpenSettings,
}) {
  const [selectedPeerId, setSelectedPeerId] = useState(null);

  const voiceParticipants = users.filter((u) => {
    if (u.id === myUserId) return isInVoice || u.inVoice;
    return Boolean(u.inVoice);
  });

  const selectedPeer = voiceParticipants.find((u) => u.id === selectedPeerId) || null;

  return (
    <div className="voice-dock">
      {!isInVoice ? (
        <div className="voice-dock-idle">
          <div className="voice-dock-idle-info">
            <div className="voice-dock-title-row">
              <Headphones size={14} className="voice-dock-icon" />
              <span className="voice-dock-title">Voice Chat</span>
              {voiceParticipants.length > 0 && (
                <span className="voice-dock-count">
                  {voiceParticipants.length} active
                </span>
              )}
            </div>
            <span className="voice-dock-sub">
              {getNoiseBadgeLabel(activeNoiseMode)} noise suppression ready
            </span>
          </div>

          <div className="voice-dock-idle-actions">
            <button
              type="button"
              className="btn-icon voice-icon-btn"
              onClick={onOpenSettings}
              title="Voice & Audio Settings"
              aria-label="Voice settings"
            >
              <SlidersHorizontal size={14} />
            </button>
            <button
              type="button"
              className="btn btn-sm voice-join-btn"
              onClick={onJoinVoice}
              disabled={isJoining}
            >
              {isJoining ? (
                <Loader2 size={13} className="spinner" />
              ) : (
                <PhoneCall size={13} />
              )}
              <span>{isJoining ? 'Joining...' : 'Join Voice'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="voice-dock-active">
          <div className="voice-dock-status-row">
            <div className="voice-dock-connected">
              <span className="voice-live-dot" />
              <div className="voice-dock-connected-text">
                <span className="voice-connected-label">Voice Connected</span>
                <span className="voice-mode-tag">
                  {activeNoiseMode === 'rnnoise' && <Sparkles size={10} />}
                  <span>{getNoiseBadgeLabel(activeNoiseMode)}</span>
                </span>
              </div>
            </div>

            <div className="voice-dock-header-actions">
              <button
                type="button"
                className="btn-icon voice-icon-btn"
                onClick={onOpenSettings}
                title="Voice & Audio Settings"
                aria-label="Voice settings"
              >
                <SlidersHorizontal size={14} />
              </button>
              <button
                type="button"
                className="btn-icon voice-icon-btn voice-disconnect-btn"
                onClick={onLeaveVoice}
                title="Disconnect from voice"
                aria-label="Disconnect from voice"
              >
                <PhoneOff size={14} />
              </button>
            </div>
          </div>

          {voiceParticipants.length > 0 && (
            <div className="voice-participants-list">
              {voiceParticipants.map((peer) => {
                const isMe = peer.id === myUserId;
                const peerSpeaking = isMe ? isTalking : speakingPeers.has(peer.id);
                const peerMuted = isMe ? (isMuted || isDeafened) : Boolean(peer.voiceMuted);
                const peerDeafened = isMe ? isDeafened : Boolean(peer.voiceDeafened);
                const isLocallyMuted = !isMe && locallyMutedPeers.has(peer.id);

                return (
                  <button
                    key={peer.id}
                    type="button"
                    className={`voice-peer-chip ${peerSpeaking ? 'is-speaking' : ''} ${selectedPeerId === peer.id ? 'is-selected' : ''}`}
                    onClick={() => {
                      if (!isMe) {
                        setSelectedPeerId((prev) => (prev === peer.id ? null : peer.id));
                      }
                    }}
                    title={isMe ? `${peer.name} (You)` : `Adjust volume for ${peer.name}`}
                  >
                    <span className={`voice-peer-avatar ${peerSpeaking ? 'is-speaking' : ''}`}>
                      {peer.name?.[0]?.toUpperCase() || '?'}
                    </span>
                    <span className="voice-peer-name">
                      {peer.name}
                      {isMe ? ' (You)' : ''}
                    </span>
                    {isLocallyMuted ? (
                      <VolumeX size={11} className="voice-peer-state-icon is-danger" />
                    ) : peerDeafened ? (
                      <HeadphoneOff size={11} className="voice-peer-state-icon is-danger" />
                    ) : peerMuted ? (
                      <MicOff size={11} className="voice-peer-state-icon is-danger" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {selectedPeer && (
            <div className="voice-peer-volume-panel">
              <div className="voice-peer-volume-header">
                <span className="voice-peer-volume-name">{selectedPeer.name}</span>
                <span className="voice-peer-volume-val">
                  {locallyMutedPeers.has(selectedPeer.id)
                    ? 'Muted'
                    : `${peerVolumes[selectedPeer.id] ?? 100}%`}
                </span>
              </div>
              <div className="voice-peer-volume-controls">
                <button
                  type="button"
                  className={`btn-icon voice-icon-btn ${locallyMutedPeers.has(selectedPeer.id) ? 'is-danger' : ''}`}
                  onClick={() => onToggleLocalPeerMute(selectedPeer.id)}
                  title={locallyMutedPeers.has(selectedPeer.id) ? 'Unmute user' : 'Mute user for you'}
                  aria-label="Toggle user mute"
                >
                  {locallyMutedPeers.has(selectedPeer.id) ? (
                    <VolumeX size={13} />
                  ) : (
                    <Volume2 size={13} />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={peerVolumes[selectedPeer.id] ?? 100}
                  onChange={(e) => onSetPeerVolume(selectedPeer.id, Number(e.target.value))}
                  className="voice-range-input"
                  aria-label={`Volume for ${selectedPeer.name}`}
                />
              </div>
            </div>
          )}

          {inputMode === 'ptt' && (
            <button
              type="button"
              className={`voice-ptt-bar ${isPttPressed ? 'is-active' : ''}`}
              onPointerDown={() => onSetPttPressed(true)}
              onPointerUp={() => onSetPttPressed(false)}
              onPointerLeave={() => onSetPttPressed(false)}
              onPointerCancel={() => onSetPttPressed(false)}
            >
              <Radio size={12} />
              <span>{isPttPressed ? 'Transmitting...' : 'Hold V or Press to Talk'}</span>
            </button>
          )}

          <div className="voice-dock-controls">
            <button
              type="button"
              className={`voice-control-btn ${isMuted || isDeafened ? 'is-danger' : ''}`}
              onClick={onToggleMute}
              title={isMuted || isDeafened ? 'Unmute Mic (Shift+M)' : 'Mute Mic (Shift+M)'}
              aria-label={isMuted || isDeafened ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted || isDeafened ? <MicOff size={15} /> : <Mic size={15} />}
              <span>{isMuted || isDeafened ? 'Muted' : 'Mic On'}</span>
            </button>

            <button
              type="button"
              className={`voice-control-btn ${isDeafened ? 'is-danger' : ''}`}
              onClick={onToggleDeafen}
              title={isDeafened ? 'Undeafen (Shift+D)' : 'Deafen (Shift+D)'}
              aria-label={isDeafened ? 'Undeafen' : 'Deafen'}
            >
              {isDeafened ? <HeadphoneOff size={15} /> : <Headphones size={15} />}
              <span>{isDeafened ? 'Deafened' : 'Audio'}</span>
            </button>

            <div className="voice-meter-wrap" title="Live microphone level">
              <div
                className={`voice-meter-fill ${isTalking ? 'is-talking' : ''}`}
                style={{ width: `${isMuted || isDeafened ? 0 : micLevel}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(VoiceDock);
