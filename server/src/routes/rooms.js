import express from 'express';
import fs from 'fs';
import path from 'path';
import { MEDIA_DIR, HLS_DIR, ALLOWED_EXTENSIONS } from '../config.js';
import { transcodeToHLS } from '../services/ffmpeg.js';
import {
  createRoom,
  getRoom,
  getAllRooms,
  roomPublicView,
} from '../services/roomManager.js';

const router = express.Router();

// GET /api/rooms — list all active rooms for discovery / search
router.get('/', (_req, res) => {
  res.json(getAllRooms());
});

// POST /api/rooms — create a new room
router.post('/', async (req, res) => {
  const { movie, name } = req.body;

  if (!movie) {
    return res.status(400).json({ error: 'movie filename is required' });
  }

  // Validate extension
  const ext = path.extname(movie).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return res.status(400).json({ error: 'Unsupported movie format' });
  }

  // Check file exists
  const moviePath = path.join(MEDIA_DIR, movie);
  if (!fs.existsSync(moviePath)) {
    return res.status(404).json({ error: `Movie not found: ${movie}` });
  }

  // Create room with custom name if provided
  const movieName = path.basename(movie, ext);
  const room = createRoom(movie, movieName, name);

  // Background transcode to HLS if needed (optional fallback)
  transcodeToHLS(moviePath, room.id).catch((err) => {
    console.warn(`[Transcode] Background HLS note for room ${room.id}:`, err.message);
  });

  res.json({
    roomId: room.id,
    url: `/watch/${room.id}`,
    ...roomPublicView(room),
  });
});

// GET /api/rooms/:id — get room state
router.get('/:id', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(roomPublicView(room));
});

// GET /api/rooms/:id/stream/status — check stream status
router.get('/:id/stream/status', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const moviePath = path.join(MEDIA_DIR, room.movie);
  const fileExists = fs.existsSync(moviePath);
  const playlist = path.join(HLS_DIR, req.params.id, 'index.m3u8');
  const hlsReady = fs.existsSync(playlist);

  // Direct progressive streaming is ready immediately when movie exists
  res.json({
    ready: fileExists,
    directPlay: fileExists,
    hlsReady,
    movie: room.movie,
  });
});

// GET /api/rooms/:id/video — Direct progressive video streaming (NAS style with HTTP 206 Range)
router.get('/:id/video', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const moviePath = path.join(MEDIA_DIR, room.movie);
  if (!fs.existsSync(moviePath)) {
    return res.status(404).json({ error: 'Movie file not found' });
  }

  const stat = fs.statSync(moviePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(room.movie).toLowerCase();
  let contentType = 'video/mp4';
  if (ext === '.webm') contentType = 'video/webm';
  else if (ext === '.mkv') contentType = 'video/x-matroska';
  else if (ext === '.avi') contentType = 'video/x-msvideo';
  else if (ext === '.mov') contentType = 'video/quicktime';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    const chunksize = end - start + 1;
    const stream = fs.createReadStream(moviePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType,
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
    });
    fs.createReadStream(moviePath).pipe(res);
  }
});

// GET /api/rooms/:id/stream/* — serve HLS files (fallback)
router.get('/:id/stream/*', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const hlsBase = path.join(HLS_DIR, req.params.id);
  const filePath = path.join(hlsBase, req.params[0]);

  // Security: prevent path traversal
  if (!filePath.startsWith(hlsBase)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Segment not found' });
  }

  const ext = path.extname(filePath);
  const contentType =
    ext === '.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
});

export default router;
