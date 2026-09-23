import crypto from 'crypto';
import { ROOM_EXPIRY_MS } from '../config.js';
import { cleanupHLS } from './ffmpeg.js';

/** @type {Map<string, Room>} */
const rooms = new Map();

/**
 * @typedef {Object} ChatMessage
 * @property {string} id
 * @property {string} senderId
 * @property {string} senderName
 * @property {string} text
 * @property {number} timestamp
 * @property {boolean} isHost
 */

/**
 * @typedef {Object} RoomUser
 * @property {string} id
 * @property {string} name
 * @property {boolean} isHost
 * @property {import('ws').WebSocket} ws
 */

/**
 * @typedef {Object} Room
 * @property {string} id
 * @property {string} name         - custom room title (e.g. "Movie Night")
 * @property {string} movie        - filename (e.g. "interstellar.mkv")
 * @property {string} movieName    - display name (no extension)
 * @property {number} currentTime
 * @property {boolean} playing
 * @property {number} lastUpdated  - timestamp of last play/pause/seek/tick
 * @property {string|null} hostId
 * @property {string|null} creatorId
 * @property {ReturnType<typeof setTimeout>|null} hostPromotionTimer
 * @property {RoomUser[]} users
 * @property {ChatMessage[]} messages
 * @property {number} createdAt
 * @property {ReturnType<typeof setTimeout>} expiryTimer
 */

function generateRoomId() {
  return crypto.randomBytes(8).toString('hex');
}

function resetExpiry(room) {
  clearTimeout(room.expiryTimer);
  room.expiryTimer = setTimeout(() => {
    console.log(`[Room] Expiring room ${room.id}`);
    deleteRoom(room.id);
  }, ROOM_EXPIRY_MS);
}

/**
 * Calculate accurate current playback time accounting for elapsed time while playing
 */
export function getCurrentRoomTime(room) {
  if (!room) return 0;
  if (!room.playing || !room.lastUpdated) {
    return room.currentTime || 0;
  }
  const elapsed = (Date.now() - room.lastUpdated) / 1000;
  return (room.currentTime || 0) + elapsed;
}

/**
 * Create a new room and return it.
 * @param {string} movie     - filename
 * @param {string} movieName - display name
 * @param {string} [name]    - optional custom room title
 * @param {string} [creatorId] - persistent client ID of creator
 * @returns {Room}
 */
export function createRoom(movie, movieName, name = null, creatorId = null, streamType = "server") {
  const id = generateRoomId();
  const roomTitle = (name && name.trim()) ? name.trim() : movieName;

  const room = {
    id,
    name: roomTitle,
    movie,
    movieName,
    streamType: streamType || (movie === "p2p-stream" ? "p2p" : "server"),
    currentTime: 0,
    playing: false,
    lastUpdated: Date.now(),
    hostId: creatorId || null,
    creatorId: creatorId || null,
    hostPromotionTimer: null,
    users: [],
    messages: [],
    createdAt: Date.now(),
    expiryTimer: null,
  };
  rooms.set(id, room);
  resetExpiry(room);
  console.log(`[Room] Created room ${id} ("${roomTitle}") for movie "${movieName}" (creatorId=${creatorId})`);
  return room;
}

export function getRoom(id) {
  return rooms.get(id) || null;
}

export function deleteRoom(id) {
  const room = rooms.get(id);
  if (room) {
    clearTimeout(room.expiryTimer);
    clearTimeout(room.hostPromotionTimer);
    rooms.delete(id);
    cleanupHLS(id);
    console.log(`[Room] Deleted room ${id}`);
  }
}

/**
 * Add or reconnect a user in a room.
 * If user with user.id already exists, updates socket and preserves host status.
 * @param {string} roomId
 * @param {RoomUser} user
 * @returns {{ room: Room, isReconnect: boolean }|null}
 */
export function addUser(roomId, user) {
  const room = getRoom(roomId);
  if (!room) return null;

  // If host returns, clear any pending host promotion timer
  if (room.hostPromotionTimer && (user.id === room.hostId || user.id === room.creatorId)) {
    clearTimeout(room.hostPromotionTimer);
    room.hostPromotionTimer = null;
    console.log(`[Room] Host ${user.name} (${user.id}) returned within grace period. Host status kept.`);
  }

  const existingIndex = room.users.findIndex((u) => u.id === user.id);
  if (existingIndex !== -1) {
    const existing = room.users[existingIndex];
    if (existing.ws && existing.ws !== user.ws) {
      try {
        existing.ws.close();
      } catch {}
    }
    user.isHost = existing.isHost || (room.hostId === user.id) || (room.creatorId === user.id);
    room.users[existingIndex] = user;
    if (user.isHost) {
      room.hostId = user.id;
    }
    resetExpiry(room);
    return { room, isReconnect: true };
  }

  // If this user is the room creator or recognized host, restore host
  if (room.hostId === user.id || room.creatorId === user.id) {
    user.isHost = true;
    room.hostId = user.id;
    if (room.hostPromotionTimer) {
      clearTimeout(room.hostPromotionTimer);
      room.hostPromotionTimer = null;
    }
  } else {
    // If room has no active host, or no users, this user becomes host
    const hasHost = room.users.some((u) => u.isHost);
    if (room.users.length === 0 || !room.hostId || !hasHost) {
      user.isHost = true;
      room.hostId = user.id;
    } else {
      user.isHost = false;
    }
  }

  room.users.push(user);
  resetExpiry(room);
  return { room, isReconnect: false };
}

/**
 * Remove a user from a room if the closing socket matches.
 * If host leaves, promote next user after a 15-second grace period (so page reloads don't lose host).
 * @param {string} roomId
 * @param {string} userId
 * @param {import('ws').WebSocket} [ws]
 */
export function removeUser(roomId, userId, ws = null) {
  const room = getRoom(roomId);
  if (!room) return null;

  const existing = room.users.find((u) => u.id === userId);
  if (existing && ws && existing.ws !== ws) {
    return null;
  }

  const wasHost = existing?.isHost || (room.hostId === userId);
  room.users = room.users.filter((u) => u.id !== userId);

  // If host leaves and other members are still present, give 15s grace period before promoting someone else
  if (wasHost && room.users.length > 0) {
    clearTimeout(room.hostPromotionTimer);
    room.hostPromotionTimer = setTimeout(() => {
      const currentRoom = getRoom(roomId);
      if (!currentRoom || currentRoom.users.length === 0) return;
      const hostStillConnected = currentRoom.users.some((u) => u.id === currentRoom.hostId);
      if (!hostStillConnected && currentRoom.users.length > 0) {
        currentRoom.users[0].isHost = true;
        currentRoom.hostId = currentRoom.users[0].id;
        console.log(`[Room] Host grace period expired. Promoted ${currentRoom.users[0].name} to host in room ${roomId}`);
        broadcast(roomId, {
          type: 'host_changed',
          newHostId: currentRoom.hostId,
          newHostName: currentRoom.users[0].name,
        });
      }
    }, 15000);
  }

  // NOTE: If room.users.length === 0, keep room.hostId intact so lone host can refresh smoothly!

  resetExpiry(room);
  return room;
}

/**
 * Add a chat message to room history (max 50 messages).
 * @param {string} roomId
 * @param {ChatMessage} message
 */
export function addChatMessage(roomId, message) {
  const room = getRoom(roomId);
  if (!room) return null;
  if (!room.messages) room.messages = [];
  room.messages.push(message);
  if (room.messages.length > 50) {
    room.messages = room.messages.slice(-50);
  }
  return message;
}

/**
 * Get a list of all active rooms for public directory / discovery.
 */
export function getAllRooms() {
  const activeRooms = [];
  for (const room of rooms.values()) {
    const hostUser = room.users.find((u) => u.id === room.hostId || u.isHost);
    activeRooms.push({
      id: room.id,
      name: room.name || room.movieName,
      movie: room.movie,
      movieName: room.movieName,
      usersCount: room.users.length,
      playing: room.playing,
    wasPlayingBeforeHostDisconnect: Boolean(room.wasPlayingBeforeHostDisconnect),
      streamType: room.streamType || "server",
      currentTime: getCurrentRoomTime(room),
      hostName: hostUser?.name || 'Host',
      createdAt: room.createdAt,
    });
  }
  return activeRooms.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Return a safe, serializable view of the room (no ws references).
 */
export function roomPublicView(room) {
  return {
    id: room.id,
    name: room.name || room.movieName,
    movie: room.movie,
    movieName: room.movieName,
    streamType: room.streamType || "server",
    currentTime: getCurrentRoomTime(room),
    playing: room.playing,
    hostId: room.hostId,
    users: room.users.map(({ id, name, isHost }) => ({ id, name, isHost })),
    messages: (room.messages || []).map(({ id, senderId, senderName, text, timestamp, isHost }) => ({
      id,
      senderId,
      senderName,
      text,
      timestamp,
      isHost,
    })),
    createdAt: room.createdAt,
  };
}

/**
 * Broadcast a JSON message to all users in a room except optional excludeId.
 */
export function broadcast(roomId, message, excludeId = null) {
  const room = getRoom(roomId);
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const user of room.users) {
    if (user.id === excludeId) continue;
    if (user.ws && user.ws.readyState === 1 /* OPEN */) {
      try {
        user.ws.send(payload);
      } catch (err) {
        console.error(`[WS] Broadcast failed for ${user.id}:`, err.message);
      }
    }
  }
}
