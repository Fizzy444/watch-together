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
  Loader2,
  Radio,
} from 'lucide-react';

function getNoiseModeLabel(mode) {
  if (mode === 'rnnoise') return 'RNNoise AI';
  if (mode === 'browser') return 'Standard';
  return 'Raw';
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

  const selectedPeer =
    voiceParticipants.find((u) => u.id === selectedPeerId && u.id !== myUserId) || null;

  return (
    <section className="voice-dock" aria-label="Voice chat controls">
      {!isInVoice ? (
        <div className="voice-dock-idle">
          <div className="voice-dock-idle-meta">
            <div className="voice-dock-title-row">
              <Headphones size={14} className="voice-dock-icon" />
              <span className="voice-dock-title">Voice</span>
              {voiceParticipants.length > 0 && (
                <span className="voice-dock-count">{voiceParticipants.length}</span>
              )}
            </div>
            <span className="voice-dock-sub">
              {voiceParticipants.length > 0
                ? `${voiceParticipants.length} active, ${getNoiseModeLabel(activeNoiseMode)}`
                : `${getNoiseModeLabel(activeNoiseMode)} noise suppression`}
            </span>
          </div>

          <div className="voice-dock-idle-actions">
            <button
              type="button"
              className="btn-icon voice-icon-btn"
              onClick={onOpenSettings}
              title="Voice settings"
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
              <span>{isJoining ? 'Joining...' : 'Join'}</span>
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
                <span className="voice-mode-tag">{getNoiseModeLabel(activeNoiseMode)}</span>
              </div>
            </div>

            <div className="voice-dock-header-actions">
              <button
                type="button"
                className="btn-icon voice-icon-btn"
                onClick={onOpenSettings}
                title="Voice settings"
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
                const isSelected = selectedPeer?.id === peer.id;

                return (
                  <button
                    key={peer.id}
                    type="button"
                    className={`voice-peer-row ${peerSpeaking ? 'is-speaking' : ''} ${isSelected ? 'is-selected' : ''} ${isMe ? 'is-self' : ''}`}
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
                      {isMe && <span className="voice-peer-self-tag">(You)</span>}
                    </span>
                    <span className="voice-peer-indicators">
                      {!isMe && (peerVolumes[peer.id] ?? 100) !== 100 && !isLocallyMuted && (
                        <span className="voice-peer-vol-tag">
                          {peerVolumes[peer.id]}%
                        </span>
                      )}
                      {isLocallyMuted ? (
                        <VolumeX size={12} className="voice-peer-state-icon is-danger" />
                      ) : peerDeafened ? (
                        <HeadphoneOff size={12} className="voice-peer-state-icon is-danger" />
                      ) : peerMuted ? (
                        <MicOff size={12} className="voice-peer-state-icon is-danger" />
                      ) : null}
                    </span>
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
              <span>{isPttPressed ? 'Transmitting' : 'Hold V or Press to Talk'}</span>
            </button>
          )}

          <div className="voice-meter-track" title="Microphone input level">
            <div
              className={`voice-meter-fill ${isTalking ? 'is-talking' : ''}`}
              style={{ width: `${isMuted || isDeafened ? 0 : micLevel}%` }}
            />
          </div>

          <div className="voice-dock-controls">
            <button
              type="button"
              className={`voice-control-btn ${isMuted || isDeafened ? 'is-danger' : ''}`}
              onClick={onToggleMute}
              title={isMuted || isDeafened ? 'Unmute (Shift+M)' : 'Mute (Shift+M)'}
              aria-label={isMuted || isDeafened ? 'Unmute microphone' : 'Mute microphone'}
            >
              {isMuted || isDeafened ? <MicOff size={14} /> : <Mic size={14} />}
              <span>{isMuted || isDeafened ? 'Unmute' : 'Mute'}</span>
            </button>

            <button
              type="button"
              className={`voice-control-btn ${isDeafened ? 'is-danger' : ''}`}
              onClick={onToggleDeafen}
              title={isDeafened ? 'Undeafen (Shift+D)' : 'Deafen (Shift+D)'}
              aria-label={isDeafened ? 'Undeafen' : 'Deafen'}
            >
              {isDeafened ? <HeadphoneOff size={14} /> : <Headphones size={14} />}
              <span>{isDeafened ? 'Undeafen' : 'Deafen'}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default memo(VoiceDock);
