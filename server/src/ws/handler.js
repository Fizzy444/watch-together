import crypto from 'crypto';
import {
  getRoom,
  addUser,
  removeUser,
  broadcast,
  roomPublicView,
} from '../services/roomManager.js';
import { SYNC_TICK_INTERVAL_MS } from '../config.js';

/** Map<roomId, NodeJS.Timeout> for sync ticks */
const syncTickers = new Map();

function startSyncTick(roomId) {
  if (syncTickers.has(roomId)) return;
  const timer = setInterval(() => {
    const room = getRoom(roomId);
    if (!room || room.users.length === 0) {
      clearInterval(timer);
      syncTickers.delete(roomId);
      return;
    }
    broadcast(roomId, {
      type: 'sync_tick',
      position: room.currentTime,
      playing: room.playing,
      serverTime: Date.now(),
    });
  }, SYNC_TICK_INTERVAL_MS);
  syncTickers.set(roomId, timer);
}

function stopSyncTick(roomId) {
  const timer = syncTickers.get(roomId);
  if (timer) {
    clearInterval(timer);
    syncTickers.delete(roomId);
  }
}

/**
 * Handle a new WebSocket connection.
 * @param {import('ws').WebSocket} ws
 * @param {import('http').IncomingMessage} req
 */
export function handleConnection(ws, req) {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const roomId = params.get('room');
  const userName = (params.get('name') || 'Anonymous').trim();
  const clientId = params.get('clientId') || crypto.randomUUID();

  if (!roomId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing room param' }));
    ws.close();
    return;
  }

  const currentRoomId = roomId;

  // Send initial error if room not found
  const room = getRoom(roomId);
  if (!room) {
    ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
    ws.close();
    return;
  }

  // Add or reconnect user in room
  const user = { id: clientId, name: userName, isHost: false, ws };
  const result = addUser(roomId, user);
  if (!result) {
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to join room' }));
    ws.close();
    return;
  }

  const { room: updatedRoom, isReconnect } = result;

  console.log(`[WS] ${userName} (${clientId}) joined room ${roomId} (isReconnect=${isReconnect}, isHost=${user.isHost})`);

  // Send full room state to the connecting user
  ws.send(JSON.stringify({
    type: 'room_state',
    room: roomPublicView(updatedRoom),
    yourId: clientId,
  }));

  // Only broadcast to others if this was a brand new member
  if (!isReconnect) {
    broadcast(roomId, {
      type: 'user_joined',
      user: { id: clientId, name: userName, isHost: user.isHost },
    }, clientId);
  }

  // Start sync ticker
  startSyncTick(roomId);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    const currentRoom = getRoom(currentRoomId);
    if (!currentRoom) return;

    // Check host by clientId or if user is flagged isHost
    const isHost = currentRoom.hostId === clientId || currentRoom.users.some((u) => u.id === clientId && u.isHost);

    switch (msg.type) {
      case 'play': {
        if (!isHost) {
          ws.send(JSON.stringify({ type: 'error', message: 'Only the host can control playback' }));
          return;
        }
        currentRoom.playing = true;
        currentRoom.currentTime = msg.position ?? currentRoom.currentTime;
        broadcast(currentRoomId, {
          type: 'play',
          position: currentRoom.currentTime,
          serverTime: Date.now(),
          initiator: userName,
        });
        break;
      }

      case 'pause': {
        if (!isHost) {
          ws.send(JSON.stringify({ type: 'error', message: 'Only the host can control playback' }));
          return;
        }
        currentRoom.playing = false;
        currentRoom.currentTime = msg.position ?? currentRoom.currentTime;
        broadcast(currentRoomId, {
          type: 'pause',
          position: currentRoom.currentTime,
          initiator: userName,
        });
        break;
      }

      case 'seek': {
        if (!isHost) {
          ws.send(JSON.stringify({ type: 'error', message: 'Only the host can control playback' }));
          return;
        }
        currentRoom.currentTime = msg.position ?? currentRoom.currentTime;
        broadcast(currentRoomId, {
          type: 'seek',
          position: currentRoom.currentTime,
          initiator: userName,
        });
        break;
      }

      case 'time_update': {
        if (isHost) {
          currentRoom.currentTime = msg.position ?? currentRoom.currentTime;
        }
        break;
      }

      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong', serverTime: Date.now() }));
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${msg.type}` }));
    }
  });

  ws.on('close', () => {
    console.log(`[WS] ${userName} (${clientId}) disconnected from room ${currentRoomId}`);
    const r = removeUser(currentRoomId, clientId, ws);
    if (r) {
      broadcast(currentRoomId, { type: 'user_left', userId: clientId, userName });
      if (r.users.length === 0) {
        stopSyncTick(currentRoomId);
      }
      const newHost = r.users.find((u) => u.isHost);
      if (newHost) {
        broadcast(currentRoomId, {
          type: 'host_changed',
          newHostId: newHost.id,
          newHostName: newHost.name,
        });
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error for user ${clientId}:`, err.message);
  });
}
