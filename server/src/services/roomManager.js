import crypto from 'crypto';
import { ROOM_EXPIRY_MS } from '../config.js';
import { cleanupHLS } from './ffmpeg.js';

/** @type {Map<string, Room>} */
const rooms = new Map();

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
 * @property {string} movie        - filename (e.g. "interstellar.mkv")
 * @property {string} movieName    - display name (no extension)
 * @property {number} currentTime
 * @property {boolean} playing
 * @property {string|null} hostId
 * @property {RoomUser[]} users
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
 * Create a new room and return it.
 * @param {string} movie   - filename
 * @param {string} movieName - display name
 * @returns {Room}
 */
export function createRoom(movie, movieName) {
  const id = generateRoomId();
  const room = {
    id,
    movie,
    movieName,
    currentTime: 0,
    playing: false,
    hostId: null,
    users: [],
    createdAt: Date.now(),
    expiryTimer: null,
  };
  rooms.set(id, room);
  resetExpiry(room);
  console.log(`[Room] Created room ${id} for movie "${movieName}"`);
  return room;
}

export function getRoom(id) {
  return rooms.get(id) || null;
}

export function deleteRoom(id) {
  const room = rooms.get(id);
  if (room) {
    clearTimeout(room.expiryTimer);
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

  const existingIndex = room.users.findIndex((u) => u.id === user.id);
  if (existingIndex !== -1) {
    const existing = room.users[existingIndex];
    if (existing.ws && existing.ws !== user.ws) {
      try {
        existing.ws.close();
      } catch {}
    }
    user.isHost = existing.isHost;
    room.users[existingIndex] = user;
    if (existing.isHost) {
      room.hostId = user.id;
    }
    resetExpiry(room);
    return { room, isReconnect: true };
  }

  // If room has no users, or hostId is null, or no existing host, this user becomes host
  const hasHost = room.users.some((u) => u.isHost);
  if (room.users.length === 0 || !room.hostId || !hasHost) {
    user.isHost = true;
    room.hostId = user.id;
  } else {
    user.isHost = false;
  }

  room.users.push(user);
  resetExpiry(room);
  return { room, isReconnect: false };
}

/**
 * Remove a user from a room if the closing socket matches.
 * If host leaves, promote next user.
 * @param {string} roomId
 * @param {string} userId
 * @param {import('ws').WebSocket} [ws]
 */
export function removeUser(roomId, userId, ws = null) {
  const room = getRoom(roomId);
  if (!room) return null;

  const existing = room.users.find((u) => u.id === userId);
  // If a specific socket was passed and it doesn't match the active user's socket, ignore
  if (existing && ws && existing.ws !== ws) {
    return null;
  }

  room.users = room.users.filter((u) => u.id !== userId);

  if (room.users.length === 0) {
    room.hostId = null;
    return room;
  }

  // If host was removed or there is no current host, promote first remaining user
  const hostStillPresent = room.users.some((u) => u.id === room.hostId && u.isHost);
  if (!hostStillPresent) {
    room.users[0].isHost = true;
    room.hostId = room.users[0].id;
    console.log(`[Room] Promoted ${room.users[0].name} to host in room ${roomId}`);
  }

  resetExpiry(room);
  return room;
}

/**
 * Return a safe, serializable view of the room (no ws references).
 */
export function roomPublicView(room) {
  return {
    id: room.id,
    movie: room.movie,
    movieName: room.movieName,
    currentTime: room.currentTime,
    playing: room.playing,
    hostId: room.hostId,
    users: room.users.map(({ id, name, isHost }) => ({ id, name, isHost })),
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
