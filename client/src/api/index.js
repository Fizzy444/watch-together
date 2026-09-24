const SERVER_URL = import.meta.env.VITE_SERVER_URL
  ? import.meta.env.VITE_SERVER_URL.replace(/\/+$/, "")
  : "";
const BASE = `${SERVER_URL}/api`;

export async function getMovies() {
  const res = await fetch(`${BASE}/movies`);
  if (!res.ok) throw new Error('Failed to fetch movies');
  return res.json();
}

export async function getActiveRooms() {
  const res = await fetch(`${BASE}/rooms`);
  if (!res.ok) throw new Error('Failed to fetch active rooms');
  return res.json();
}

export async function uploadMovie(file, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('movie', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}/movies/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        const err = JSON.parse(xhr.responseText);
        reject(new Error(err.error || 'Upload failed'));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(form);
  });
}

export async function createRoom(movie, name = '', clientId = '', extra = {}) {
  const payload = typeof movie === 'object'
    ? { ...movie, clientId: movie.clientId || clientId }
    : { movie, name, clientId, ...extra };

  const res = await fetch(`${BASE}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create room');
  }
  return res.json();
}

export async function getRoom(roomId) {
  const res = await fetch(`${BASE}/rooms/${roomId}`);
  if (!res.ok) throw new Error('Room not found');
  return res.json();
}

export async function getStreamStatus(roomId) {
  const res = await fetch(`${BASE}/rooms/${roomId}/stream/status`);
  if (!res.ok) return { ready: false };
  return res.json();
}

export async function closeRoom(roomId, clientId = '') {
  const res = await fetch(`${BASE}/rooms/${roomId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': clientId,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to close room');
  }
  return res.json();
}
