import { useEffect, useRef, useState, useCallback } from "react";

export const ICE_SERVERS = [
  // Google STUN (Direct P2P NAT hole punching)
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // OpenRelay TURN Fallback (Bridges restrictive cellular carriers & CGNAT)
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turn:openrelay.metered.ca:443?transport=tcp"
    ],
    username: "openrelay",
    credential: "openrelay"
  }
];

export function useWebRTC({
  isHost,
  isP2P,
  localStream,
  send,
  wsMsg,
  hostId,
  myUserId,
  connected
}) {
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState("idle");
  const [connectedViewersCount, setConnectedViewersCount] = useState(0);

  // Host: Map<viewerId, RTCPeerConnection>
  const peersRef = useRef(new Map());
  // Viewer: single RTCPeerConnection
  const viewerPcRef = useRef(null);

  // Candidates queue before remoteDescription is ready
  const candidatesQueueRef = useRef(new Map());

  const localStreamRef = useRef(localStream);
  localStreamRef.current = localStream;

  const updateHostPeerCount = useCallback(() => {
    let count = 0;
    for (const pc of peersRef.current.values()) {
      if (pc.connectionState === "connected") {
        count++;
      }
    }
    setConnectedViewersCount(count);
  }, []);

  // HOST: Initiate WebRTC connection when viewer is ready
  const handleViewerReady = useCallback(async (viewerId) => {
    if (!isHost || !localStreamRef.current) {
      console.log("[WebRTC Host] Received ready, but no stream or not host yet.");
      return;
    }

    console.log(`[WebRTC Host] Establishing connection to viewer: ${viewerId}`);

    // Clean up any existing connection for this viewer
    if (peersRef.current.has(viewerId)) {
      try {
        peersRef.current.get(viewerId).close();
      } catch {}
      peersRef.current.delete(viewerId);
    }

    try {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(viewerId, pc);

      // Add local media tracks (video & audio)
      const tracks = localStreamRef.current.getTracks();
      console.log(`[WebRTC Host] Attaching ${tracks.length} tracks to viewer ${viewerId}`);
      tracks.forEach((track) => {
        pc.addTrack(track, localStreamRef.current);
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send("webrtc_signal", {
            targetUserId: viewerId,
            signal: { type: "candidate", candidate: event.candidate.toJSON() }
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC Host] Viewer ${viewerId} state: ${pc.connectionState}`);
        updateHostPeerCount();
      };

      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      send("webrtc_signal", {
        targetUserId: viewerId,
        signal: { type: "offer", sdp: offer.sdp }
      });
    } catch (err) {
      console.error(`[WebRTC Host] Failed to create offer for ${viewerId}:`, err);
    }
  }, [isHost, send, updateHostPeerCount]);

  // HOST: Update tracks if localStream changes while peers are already connected
  useEffect(() => {
    if (!isHost || !localStream) return;

    for (const [viewerId, pc] of peersRef.current.entries()) {
      if (pc.signalingState !== "closed") {
        const senders = pc.getSenders();
        const tracks = localStream.getTracks();
        tracks.forEach((track) => {
          const sender = senders.find((s) => s.track && s.track.kind === track.kind);
          if (sender) {
            sender.replaceTrack(track).catch((e) => console.warn("[WebRTC] replaceTrack error:", e));
          } else {
            try {
              pc.addTrack(track, localStream);
            } catch {}
          }
        });
      }
    }
    // Broadcast status to room
    send("webrtc_host_stream_status", { isBroadcasting: true });
  }, [isHost, localStream, send]);

  // VIEWER: Signal readiness to host
  const requestStreamFromHost = useCallback(() => {
    if (isHost || !isP2P || !connected) return;
    console.log("[WebRTC Viewer] Requesting stream from host...");
    setConnectionState("connecting");
    send("webrtc_ready", {});
  }, [isHost, isP2P, connected, send]);

  // Trigger stream request when entering room
  useEffect(() => {
    if (!isHost && isP2P && connected) {
      requestStreamFromHost();
    }
  }, [isHost, isP2P, connected, requestStreamFromHost]);

  // WebSocket Message Dispatcher for WebRTC
  useEffect(() => {
    if (!wsMsg || !isP2P) return;

    // HOST HANDLERS
    if (isHost) {
      if (wsMsg.type === "webrtc_ready" && wsMsg.senderId) {
        handleViewerReady(wsMsg.senderId);
      }

      if (wsMsg.type === "webrtc_signal" && wsMsg.senderId) {
        const { senderId, signal } = wsMsg;
        const pc = peersRef.current.get(senderId);
        if (!pc) return;

        if (signal.type === "answer") {
          console.log(`[WebRTC Host] Setting remote answer from viewer ${senderId}`);
          pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: signal.sdp }))
            .then(async () => {
              // Flush any queued candidates
              const queue = candidatesQueueRef.current.get(senderId) || [];
              for (const cand of queue) {
                try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
              }
              candidatesQueueRef.current.delete(senderId);
            })
            .catch((err) => console.error("[WebRTC Host] setRemoteDescription error:", err));
        } else if (signal.type === "candidate" && signal.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
          } else {
            const queue = candidatesQueueRef.current.get(senderId) || [];
            queue.push(signal.candidate);
            candidatesQueueRef.current.set(senderId, queue);
          }
        }
      }

      if (wsMsg.type === "webrtc_peer_disconnected" && wsMsg.peerId) {
        const pc = peersRef.current.get(wsMsg.peerId);
        if (pc) {
          try { pc.close(); } catch {}
          peersRef.current.delete(wsMsg.peerId);
          updateHostPeerCount();
        }
      }
    }

    // VIEWER HANDLERS
    if (!isHost) {
      if (wsMsg.type === "webrtc_signal" && wsMsg.signal) {
        const { senderId, signal } = wsMsg;

        if (signal.type === "offer") {
          console.log("[WebRTC Viewer] Received offer from host");
          if (viewerPcRef.current) {
            try { viewerPcRef.current.close(); } catch {}
          }

          const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
          viewerPcRef.current = pc;

          const remoteMediaStream = new MediaStream();
          pc.ontrack = (event) => {
            console.log("[WebRTC Viewer] Received remote track:", event.track.kind);
            if (event.streams && event.streams[0]) {
              setRemoteStream(event.streams[0]);
            } else {
              remoteMediaStream.addTrack(event.track);
              setRemoteStream(remoteMediaStream);
            }
            setConnectionState("connected");
          };

          pc.onicecandidate = (event) => {
            if (event.candidate) {
              send("webrtc_signal", {
                targetUserId: senderId,
                signal: { type: "candidate", candidate: event.candidate.toJSON() }
              });
            }
          };

          pc.onconnectionstatechange = () => {
            console.log("[WebRTC Viewer] Connection state:", pc.connectionState);
            setConnectionState(pc.connectionState);
          };

          pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: signal.sdp }))
            .then(async () => {
              // Flush any queued candidates
              const queue = candidatesQueueRef.current.get(senderId) || [];
              for (const cand of queue) {
                try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch {}
              }
              candidatesQueueRef.current.delete(senderId);

              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);

              send("webrtc_signal", {
                targetUserId: senderId,
                signal: { type: "answer", sdp: answer.sdp }
              });
            })
            .catch((err) => {
              console.error("[WebRTC Viewer] Failed to handle offer:", err);
              setConnectionState("failed");
            });
        } else if (signal.type === "candidate" && signal.candidate) {
          const pc = viewerPcRef.current;
          if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
          } else {
            const queue = candidatesQueueRef.current.get(senderId) || [];
            queue.push(signal.candidate);
            candidatesQueueRef.current.set(senderId, queue);
          }
        }
      }

      if (wsMsg.type === "webrtc_host_stream_status") {
        if (wsMsg.isBroadcasting && connectionState !== "connected") {
          requestStreamFromHost();
        }
      }

      if (wsMsg.type === "host_changed") {
        // If host changed, reset connection and request from new host
        if (viewerPcRef.current) {
          try { viewerPcRef.current.close(); } catch {}
          viewerPcRef.current = null;
        }
        setRemoteStream(null);
        setConnectionState("idle");
        requestStreamFromHost();
      }
    }
  }, [wsMsg, isHost, isP2P, handleViewerReady, send, connectionState, requestStreamFromHost]);

  // Clean up all connections on unmount
  useEffect(() => {
    return () => {
      for (const pc of peersRef.current.values()) {
        try { pc.close(); } catch {}
      }
      peersRef.current.clear();
      if (viewerPcRef.current) {
        try { viewerPcRef.current.close(); } catch {}
        viewerPcRef.current = null;
      }
    };
  }, []);

  return {
    remoteStream,
    connectionState,
    connectedViewersCount,
    requestStreamFromHost
  };
}
