import { useState, useEffect, useRef, useCallback } from 'react';
import { ICE_SERVERS } from './useWebRTC.js';
import {
  createVoiceInputPipeline,
  createRemotePeerAudio,
  optimizeOpusSdp,
  isLevelSpeaking,
  loadVoiceSettings,
  saveVoiceSettings,
  loadPeerVolumes,
  savePeerVolumes,
} from '../utils/voiceAudio.js';

const SPEAKING_POLL_INTERVAL_MS = 65;

function getFriendlyMicError(err) {
  if (!err) return 'Unable to access microphone.';
  if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
    return 'Microphone permission denied. Allow mic access in your browser or system settings.';
  }
  if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
    return 'No microphone device found.';
  }
  if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
    return 'Microphone is currently in use by another application.';
  }
  return err.message || 'Failed to start voice chat.';
}

export function useVoiceChat({ roomUsers = [], myUserId, connected, send }) {
  const [voiceSettings, setVoiceSettings] = useState(loadVoiceSettings);
  const [peerVolumes, setPeerVolumes] = useState(loadPeerVolumes);
  const [locallyMutedPeers, setLocallyMutedPeers] = useState(() => new Set());
  const [isInVoice, setIsInVoice] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isPttPressed, setIsPttPressed] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [speakingPeers, setSpeakingPeers] = useState(() => new Set());
  const [peerConnectionStates, setPeerConnectionStates] = useState({});
  const [activeNoiseMode, setActiveNoiseMode] = useState(() => loadVoiceSettings().noiseSuppressionMode);
  const [audioDevices, setAudioDevices] = useState({ inputs: [], outputs: [] });

  const pipelineRef = useRef(null);
  const peersRef = useRef(new Map());
  const remoteAudioRef = useRef(new Map());
  const candidatesQueueRef = useRef(new Map());
  const preDeafenMutedRef = useRef(false);

  const isInVoiceRef = useRef(isInVoice);
  const wasConnectedRef = useRef(connected);
  const isMutedRef = useRef(isMuted);
  const isDeafenedRef = useRef(isDeafened);
  const isPttPressedRef = useRef(isPttPressed);
  const voiceSettingsRef = useRef(voiceSettings);
  const peerVolumesRef = useRef(peerVolumes);
  const locallyMutedPeersRef = useRef(locallyMutedPeers);

  useEffect(() => {
    isInVoiceRef.current = isInVoice;
    isMutedRef.current = isMuted;
    isDeafenedRef.current = isDeafened;
    isPttPressedRef.current = isPttPressed;
    voiceSettingsRef.current = voiceSettings;
    peerVolumesRef.current = peerVolumes;
    locallyMutedPeersRef.current = locallyMutedPeers;
  }, [
    isInVoice,
    isMuted,
    isDeafened,
    isPttPressed,
    voiceSettings,
    peerVolumes,
    locallyMutedPeers,
  ]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices({
        inputs: devices.filter((d) => d.kind === 'audioinput'),
        outputs: devices.filter((d) => d.kind === 'audiooutput'),
      });
    } catch {}
  }, []);

  useEffect(() => {
    let active = true;
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          if (!active) return;
          setAudioDevices({
            inputs: devices.filter((d) => d.kind === 'audioinput'),
            outputs: devices.filter((d) => d.kind === 'audiooutput'),
          });
        })
        .catch(() => {});
    }
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => {
      active = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    };
  }, [refreshDevices]);

  const syncEffectiveMicState = useCallback(() => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    const isPttMode = voiceSettingsRef.current.inputMode === 'ptt';
    const shouldTransmit =
      !isMutedRef.current &&
      !isDeafenedRef.current &&
      (!isPttMode || isPttPressedRef.current);
    pipeline.setEnabled(shouldTransmit);
    if (!shouldTransmit) {
      setIsTalking(false);
      setMicLevel(0);
    }
  }, []);

  useEffect(() => {
    syncEffectiveMicState();
  }, [isMuted, isDeafened, isPttPressed, voiceSettings.inputMode, syncEffectiveMicState]);

  const cleanupPeer = useCallback((peerId) => {
    const pc = peersRef.current.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      peersRef.current.delete(peerId);
    }
    const audioPlayer = remoteAudioRef.current.get(peerId);
    if (audioPlayer) {
      audioPlayer.destroy();
      remoteAudioRef.current.delete(peerId);
    }
    candidatesQueueRef.current.delete(peerId);
    setSpeakingPeers((prev) => {
      if (!prev.has(peerId)) return prev;
      const next = new Set(prev);
      next.delete(peerId);
      return next;
    });
    setPeerConnectionStates((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  const createPeerConnection = useCallback(
    (peerId) => {
      cleanupPeer(peerId);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(peerId, pc);

      const localStream = pipelineRef.current?.processedStream;
      if (localStream) {
        for (const track of localStream.getAudioTracks()) {
          pc.addTrack(track, localStream);
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send('voice_signal', {
            targetUserId: peerId,
            signal: { type: 'candidate', candidate: event.candidate.toJSON() },
          });
        }
      };

      pc.onconnectionstatechange = () => {
        setPeerConnectionStates((prev) => ({
          ...prev,
          [peerId]: pc.connectionState,
        }));
      };

      pc.ontrack = (event) => {
        const stream = event.streams?.[0] || new MediaStream([event.track]);
        const existingAudio = remoteAudioRef.current.get(peerId);
        if (existingAudio) {
          existingAudio.destroy();
        }
        const volumePercent = peerVolumesRef.current[peerId] ?? 100;
        const peerMuted =
          isDeafenedRef.current || locallyMutedPeersRef.current.has(peerId);
        const audioPlayer = createRemotePeerAudio(stream, {
          volumePercent,
          muted: peerMuted,
          outputDeviceId: voiceSettingsRef.current.outputDeviceId,
        });
        remoteAudioRef.current.set(peerId, audioPlayer);
      };

      return pc;
    },
    [cleanupPeer, send]
  );

  const initiateCallToPeer = useCallback(
    async (peerId) => {
      if (!pipelineRef.current?.processedStream) return;
      const pc = createPeerConnection(peerId);
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        const tunedSdp = optimizeOpusSdp(offer.sdp);
        await pc.setLocalDescription({ type: 'offer', sdp: tunedSdp });
        send('voice_signal', {
          targetUserId: peerId,
          signal: { type: 'offer', sdp: tunedSdp },
        });
      } catch (err) {
        console.warn('[Voice] Offer creation failed:', err);
      }
    },
    [createPeerConnection, send]
  );

  const leaveVoice = useCallback(() => {
    for (const peerId of Array.from(peersRef.current.keys())) {
      cleanupPeer(peerId);
    }
    if (pipelineRef.current) {
      pipelineRef.current.destroy();
      pipelineRef.current = null;
    }
    setIsInVoice(false);
    setIsJoining(false);
    setIsTalking(false);
    setMicLevel(0);
    setIsPttPressed(false);
    setSpeakingPeers(new Set());
    setPeerConnectionStates({});
    if (connected) {
      send('voice_leave', {});
    }
  }, [cleanupPeer, connected, send]);

  const joinVoice = useCallback(async () => {
    if (isInVoiceRef.current || isJoining) return;
    if (!connected) {
      setVoiceError('Wait for room connection before joining voice.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceError('Microphone access is not supported in this browser.');
      return;
    }

    setVoiceError('');
    setIsJoining(true);
    try {
      const pipeline = await createVoiceInputPipeline(voiceSettingsRef.current);
      pipelineRef.current = pipeline;
      setActiveNoiseMode(pipeline.activeMode);
      setIsInVoice(true);
      isInVoiceRef.current = true;
      syncEffectiveMicState();
      refreshDevices();
      send('voice_join', {
        muted: isMutedRef.current || isDeafenedRef.current,
        deafened: isDeafenedRef.current,
      });
    } catch (err) {
      setVoiceError(getFriendlyMicError(err));
    } finally {
      setIsJoining(false);
    }
  }, [connected, isJoining, refreshDevices, send, syncEffectiveMicState]);

  const updateVoiceSettings = useCallback(
    async (partial) => {
      const next = { ...voiceSettingsRef.current, ...partial };
      setVoiceSettings(next);
      voiceSettingsRef.current = next;
      saveVoiceSettings(next);

      if (partial.outputDeviceId !== undefined) {
        for (const audioPlayer of remoteAudioRef.current.values()) {
          audioPlayer.setOutputDevice(partial.outputDeviceId);
        }
      }

      const needsPipelineRebuild =
        partial.noiseSuppressionMode !== undefined ||
        partial.gateThresholdDb !== undefined ||
        partial.inputMode !== undefined ||
        partial.inputDeviceId !== undefined ||
        partial.echoCancellation !== undefined ||
        partial.autoGainControl !== undefined;

      if (pipelineRef.current && !needsPipelineRebuild && partial.micGain !== undefined) {
        pipelineRef.current.setMicGain(partial.micGain);
      }

      if (isInVoiceRef.current && needsPipelineRebuild) {
        try {
          const nextPipeline = await createVoiceInputPipeline(next);
          const oldPipeline = pipelineRef.current;
          pipelineRef.current = nextPipeline;
          setActiveNoiseMode(nextPipeline.activeMode);
          syncEffectiveMicState();

          const newTrack = nextPipeline.processedStream.getAudioTracks()[0];
          if (newTrack) {
            for (const pc of peersRef.current.values()) {
              if (pc.signalingState === 'closed') continue;
              const sender = pc.getSenders().find((s) => s.track?.kind === 'audio');
              if (sender) {
                sender.replaceTrack(newTrack).catch(() => {});
              } else {
                pc.addTrack(newTrack, nextPipeline.processedStream);
              }
            }
          }
          oldPipeline?.destroy();
        } catch (err) {
          setVoiceError(getFriendlyMicError(err));
        }
      }
    },
    [syncEffectiveMicState]
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      let nextDeafened = isDeafenedRef.current;
      if (!next && nextDeafened) {
        nextDeafened = false;
        setIsDeafened(false);
        for (const [peerId, audioPlayer] of remoteAudioRef.current.entries()) {
          audioPlayer.applyVolume(
            peerVolumesRef.current[peerId] ?? 100,
            locallyMutedPeersRef.current.has(peerId)
          );
        }
      }
      if (isInVoiceRef.current) {
        send('voice_state', {
          muted: next || nextDeafened,
          deafened: nextDeafened,
        });
      }
      return next;
    });
  }, [send]);

  const toggleDeafen = useCallback(() => {
    setIsDeafened((prev) => {
      const nextDeafened = !prev;
      let nextMuted = isMutedRef.current;

      if (nextDeafened) {
        preDeafenMutedRef.current = nextMuted;
        nextMuted = true;
      } else {
        nextMuted = preDeafenMutedRef.current;
      }
      setIsMuted(nextMuted);

      for (const [peerId, audioPlayer] of remoteAudioRef.current.entries()) {
        const peerMuted = nextDeafened || locallyMutedPeersRef.current.has(peerId);
        audioPlayer.applyVolume(peerVolumesRef.current[peerId] ?? 100, peerMuted);
      }

      if (isInVoiceRef.current) {
        send('voice_state', {
          muted: nextMuted || nextDeafened,
          deafened: nextDeafened,
        });
      }
      return nextDeafened;
    });
  }, [send]);

  const setPeerVolume = useCallback((peerId, volumePercent) => {
    const clamped = Math.max(0, Math.min(200, Number(volumePercent)));
    setPeerVolumes((prev) => {
      const next = { ...prev, [peerId]: clamped };
      savePeerVolumes(next);
      return next;
    });
    const audioPlayer = remoteAudioRef.current.get(peerId);
    if (audioPlayer) {
      const peerMuted = isDeafenedRef.current || locallyMutedPeersRef.current.has(peerId);
      audioPlayer.applyVolume(clamped, peerMuted);
    }
  }, []);

  const toggleLocalPeerMute = useCallback((peerId) => {
    setLocallyMutedPeers((prev) => {
      const next = new Set(prev);
      if (next.has(peerId)) {
        next.delete(peerId);
      } else {
        next.add(peerId);
      }
      const audioPlayer = remoteAudioRef.current.get(peerId);
      if (audioPlayer) {
        audioPlayer.applyVolume(
          peerVolumesRef.current[peerId] ?? 100,
          isDeafenedRef.current || next.has(peerId)
        );
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isInVoice || !myUserId) return;

    const activeVoicePeerIds = new Set(
      roomUsers
        .filter((u) => u.inVoice && u.id !== myUserId)
        .map((u) => u.id)
    );

    for (const existingPeerId of Array.from(peersRef.current.keys())) {
      if (!activeVoicePeerIds.has(existingPeerId)) {
        cleanupPeer(existingPeerId);
      }
    }

    for (const peerId of activeVoicePeerIds) {
      if (!peersRef.current.has(peerId)) {
        if (myUserId < peerId) {
          initiateCallToPeer(peerId);
        }
      }
    }
  }, [isInVoice, roomUsers, myUserId, cleanupPeer, initiateCallToPeer]);

  const handleVoiceMessage = useCallback(
    async (msg) => {
      if (!msg) return;

      if (msg.type === 'user_left' && msg.userId) {
        cleanupPeer(msg.userId);
        return;
      }

      if (msg.type === 'voice_state' && msg.userId && msg.userId !== myUserId && !msg.inVoice) {
        cleanupPeer(msg.userId);
        return;
      }

      if (msg.type !== 'voice_signal' || !isInVoiceRef.current) return;

      const { senderId, signal } = msg;
      if (!senderId || !signal || senderId === myUserId) return;

      if (signal.type === 'offer') {
        let pc = peersRef.current.get(senderId);
        const isPolite = myUserId > senderId;
        const offerCollision =
          pc && (pc.signalingState !== 'stable');

        if (offerCollision && !isPolite) {
          return;
        }

        if (!pc || pc.signalingState === 'closed') {
          pc = createPeerConnection(senderId);
        }

        try {
          if (offerCollision) {
            await pc.setLocalDescription({ type: 'rollback' });
          }
          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'offer', sdp: signal.sdp })
          );
          const queued = candidatesQueueRef.current.get(senderId) || [];
          for (const candidate of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch {}
          }
          candidatesQueueRef.current.delete(senderId);

          const answer = await pc.createAnswer();
          const tunedSdp = optimizeOpusSdp(answer.sdp);
          await pc.setLocalDescription({ type: 'answer', sdp: tunedSdp });
          send('voice_signal', {
            targetUserId: senderId,
            signal: { type: 'answer', sdp: tunedSdp },
          });
        } catch (err) {
          console.warn('[Voice] Failed to handle offer:', err);
        }
        return;
      }

      if (signal.type === 'answer') {
        const pc = peersRef.current.get(senderId);
        if (!pc || pc.signalingState !== 'have-local-offer') return;
        try {
          await pc.setRemoteDescription(
            new RTCSessionDescription({ type: 'answer', sdp: signal.sdp })
          );
          const queued = candidatesQueueRef.current.get(senderId) || [];
          for (const candidate of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch {}
          }
          candidatesQueueRef.current.delete(senderId);
        } catch (err) {
          console.warn('[Voice] Failed to handle answer:', err);
        }
        return;
      }

      if (signal.type === 'candidate' && signal.candidate) {
        const pc = peersRef.current.get(senderId);
        if (pc && pc.remoteDescription?.type) {
          pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
        } else {
          const queued = candidatesQueueRef.current.get(senderId) || [];
          queued.push(signal.candidate);
          candidatesQueueRef.current.set(senderId, queued);
        }
      }
    },
    [cleanupPeer, createPeerConnection, myUserId, send]
  );

  useEffect(() => {
    if (!isInVoice) return;

    const timer = setInterval(() => {
      const pipeline = pipelineRef.current;
      const canTalk =
        !isMutedRef.current &&
        !isDeafenedRef.current &&
        (voiceSettingsRef.current.inputMode !== 'ptt' || isPttPressedRef.current);

      if (pipeline && canTalk) {
        const level = pipeline.getAudioLevel();
        setMicLevel(level);
        setIsTalking(isLevelSpeaking(level));
      } else {
        setMicLevel(0);
        setIsTalking(false);
      }

      setSpeakingPeers((prev) => {
        let changed = false;
        const next = new Set();
        for (const [peerId, audioPlayer] of remoteAudioRef.current.entries()) {
          const peerMuted =
            isDeafenedRef.current || locallyMutedPeersRef.current.has(peerId);
          if (!peerMuted && isLevelSpeaking(audioPlayer.getAudioLevel())) {
            next.add(peerId);
          }
        }
        if (next.size !== prev.size) {
          changed = true;
        } else {
          for (const id of next) {
            if (!prev.has(id)) {
              changed = true;
              break;
            }
          }
        }
        return changed ? next : prev;
      });
    }, SPEAKING_POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [isInVoice]);

  useEffect(() => {
    if (!isInVoice) return;

    function isTypingTarget(target) {
      const tag = target?.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
    }

    function onKeyDown(e) {
      if (isTypingTarget(e.target)) return;
      if (e.code === 'KeyM' && e.shiftKey) {
        e.preventDefault();
        toggleMute();
        return;
      }
      if (e.code === 'KeyD' && e.shiftKey) {
        e.preventDefault();
        toggleDeafen();
        return;
      }
      if (e.code === 'KeyV' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (voiceSettingsRef.current.inputMode === 'ptt' && !isPttPressedRef.current) {
          setIsPttPressed(true);
        }
      }
    }

    function onKeyUp(e) {
      if (e.code === 'KeyV') {
        setIsPttPressed(false);
      }
    }

    function onBlur() {
      setIsPttPressed(false);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [isInVoice, toggleMute, toggleDeafen]);

  useEffect(() => {
    if (!connected && isInVoiceRef.current) {
      for (const peerId of Array.from(peersRef.current.keys())) {
        cleanupPeer(peerId);
      }
    } else if (connected && !wasConnectedRef.current && isInVoiceRef.current) {
      send('voice_join', {
        muted: isMutedRef.current || isDeafenedRef.current,
        deafened: isDeafenedRef.current,
      });
    }
    wasConnectedRef.current = connected;
  }, [connected, cleanupPeer, send]);

  useEffect(() => {
    const peers = peersRef.current;
    return () => {
      for (const peerId of Array.from(peers.keys())) {
        cleanupPeer(peerId);
      }
      if (pipelineRef.current) {
        pipelineRef.current.destroy();
        pipelineRef.current = null;
      }
    };
  }, [cleanupPeer]);

  return {
    isInVoice,
    isJoining,
    voiceError,
    clearVoiceError: useCallback(() => setVoiceError(''), []),
    isMuted,
    isDeafened,
    isPttPressed,
    setIsPttPressed,
    isTalking,
    micLevel,
    speakingPeers,
    peerVolumes,
    locallyMutedPeers,
    peerConnectionStates,
    voiceSettings,
    activeNoiseMode,
    audioDevices,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    setPeerVolume,
    toggleLocalPeerMute,
    updateVoiceSettings,
    handleVoiceMessage,
  };
}
