import crypto from 'crypto';
import {
  getRoom,
  addUser,
  removeUser,
  broadcast,
  roomPublicView,
  addChatMessage,
  deleteRoom,
  getCurrentRoomTime,
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
    const currentPos = getCurrentRoomTime(room);
    broadcast(roomId, {
      type: 'sync_tick',
      position: currentPos,
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
  let userName = (params.get('name') || '').trim() || 'Guest';
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

  // Send full room state (including chat messages) to the connecting user
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
      case 'update_name': {
        const newName = typeof msg.name === 'string' ? msg.name.trim() : '';
        if (!newName) return;
        userName = newName;
        const userInRoom = currentRoom.users.find((u) => u.id === clientId);
        if (userInRoom) {
          userInRoom.name = newName;
          broadcast(currentRoomId, {
            type: 'user_updated',
            user: { id: clientId, name: newName, isHost: userInRoom.isHost },
          });
        }
        break;
      }

      case 'chat': {
        const text = typeof msg.text === 'string' ? msg.text.trim() : '';
        if (!text) return;
        const chatMsg = {
          id: crypto.randomUUID(),
          senderId: clientId,
          senderName: userName,
          text: text.slice(0, 500),
          timestamp: Date.now(),
          isHost: isHost,
        };
        addChatMessage(currentRoomId, chatMsg);
        broadcast(currentRoomId, {
          type: 'chat',
          message: chatMsg,
        });
        break;
      }

      case 'play': {
        if (!isHost) {
          ws.send(JSON.stringify({ type: 'error', message: 'Only the host can control playback' }));
          return;
        }
        currentRoom.playing = true;
        currentRoom.currentTime = msg.position ?? currentRoom.currentTime;
        currentRoom.lastUpdated = Date.now();
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
        currentRoom.lastUpdated = Date.now();
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
        currentRoom.lastUpdated = Date.now();
        broadcast(currentRoomId, {
          type: 'seek',
          position: currentRoom.currentTime,
          initiator: userName,
        });
        break;
      }

      case 'close_room': {
        if (!isHost) {
          ws.send(JSON.stringify({ type: 'error', message: 'Only the host can close the room' }));
          return;
        }
        console.log(`[WS] Host ${userName} closed room ${currentRoomId}`);
        broadcast(currentRoomId, {
          type: 'room_closed',
          message: 'The host has ended this watch session.',
        });
        stopSyncTick(currentRoomId);
        deleteRoom(currentRoomId);
        break;
      }

      case 'time_update': {
        if (isHost && typeof msg.position === 'number') {
          currentRoom.currentTime = msg.position;
          currentRoom.lastUpdated = Date.now();
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
