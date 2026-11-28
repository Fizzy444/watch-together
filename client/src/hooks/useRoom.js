import { useState, useCallback, useEffect } from 'react';

export function useRoom(initialRoom) {
  const [room, setRoom] = useState(
    initialRoom ? { messages: [], ...initialRoom } : null
  );

  useEffect(() => {
    if (initialRoom) {
      setRoom((prev) => (prev ? { messages: [], ...initialRoom, ...prev } : { messages: [], ...initialRoom }));
    }
  }, [initialRoom]);

  const applyMessage = useCallback((msg) => {
    if (!msg) return;

    switch (msg.type) {
      case 'room_state':
        setRoom({
          ...msg.room,
          messages: msg.room.messages || [],
          hostDisconnected: Boolean(msg.room?.wasPlayingBeforeHostDisconnect),
        });
        break;

      case 'chat':
        setRoom((r) => {
          if (!r) return r;
          const currentMsgs = r.messages || [];
          if (currentMsgs.some((m) => m.id === msg.message.id)) return r;
          return {
            ...r,
            messages: [...currentMsgs, msg.message],
          };
        });
        break;

      case 'user_joined':
        setRoom((r) => {
          if (!r) return r;
          const exists = r.users.some((u) => u.id === msg.user.id);
          return {
            ...r,
            users: exists
              ? r.users.map((u) => (u.id === msg.user.id ? msg.user : u))
              : [...r.users, msg.user],
          };
        });
        break;

      case 'user_updated':
        setRoom((r) => {
          if (!r) return r;
          return {
            ...r,
            users: r.users.map((u) =>
              u.id === msg.user.id
                ? { ...u, name: msg.user.name, isAdmin: msg.user.isAdmin ?? u.isAdmin }
                : u
            ),
          };
        });
        break;

      case 'admin_changed':
        setRoom((r) => {
          if (!r) return r;
          return {
            ...r,
            users: r.users.map((u) =>
              u.id === msg.userId ? { ...u, isAdmin: Boolean(msg.isAdmin) } : u
            ),
          };
        });
        break;

      case 'user_left':
        setRoom((r) => {
          if (!r) return r;
          return {
            ...r,
            users: r.users.filter((u) => u.id !== msg.userId),
          };
        });
        break;

      case 'host_changed':
        setRoom((r) => {
          if (!r) return r;
          return {
            ...r,
            hostId: msg.newHostId,
            users: r.users.map((u) => ({
              ...u,
              isHost: u.id === msg.newHostId,
              isAdmin: u.id === msg.newHostId ? false : Boolean(u.isAdmin),
            })),
          };
        });
        break;

      case 'voice_state':
        setRoom((r) => {
          if (!r) return r;
          return {
            ...r,
            users: r.users.map((u) =>
              u.id === msg.userId
                ? {
                    ...u,
                    inVoice: Boolean(msg.inVoice),
                    voiceMuted: Boolean(msg.muted),
                    voiceDeafened: Boolean(msg.deafened),
                  }
                : u
            ),
          };
        });
        break;

      case 'play':
        setRoom((r) => (!r ? r : { ...r, playing: true, currentTime: msg.position ?? r.currentTime, hostDisconnected: false }));
        break;

      case 'pause':
        setRoom((r) => (!r ? r : { ...r, playing: false, currentTime: msg.position ?? r.currentTime, hostDisconnected: Boolean(msg.hostDisconnected) }));
        break;

      case 'seek':
        setRoom((r) => (!r ? r : { ...r, currentTime: msg.position ?? r.currentTime }));
        break;

      case 'sync_tick':
        setRoom((r) => (!r ? r : { ...r, currentTime: msg.position ?? r.currentTime, playing: msg.playing ?? r.playing }));
        break;
    }
  }, []);

  return { room, setRoom, applyMessage };
}
