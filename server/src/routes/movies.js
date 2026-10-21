import express from 'express';
import fs from 'fs';
import path from 'path';
import { MEDIA_DIR, ALLOWED_EXTENSIONS } from '../config.js';

const router = express.Router();

// Ensure media dir exists
fs.mkdirSync(MEDIA_DIR, { recursive: true });

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** Helper — scan MEDIA_DIR and return movie objects if any exist */
function listMovies() {
  if (!fs.existsSync(MEDIA_DIR)) return [];
  return fs
    .readdirSync(MEDIA_DIR)
    .filter((f) => ALLOWED_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map((filename) => {
      const stats = fs.statSync(path.join(MEDIA_DIR, filename));
      const ext = path.extname(filename);
      return {
        id: Buffer.from(filename).toString('base64url'),
        filename,
        name: path.basename(filename, ext),
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// GET /api/movies — list available movies
router.get('/', (_req, res) => {
  res.json(listMovies());
});

// POST /api/movies/upload — permanently disabled (P2P WebRTC only)
router.post('/upload', (_req, res) => {
  res.status(403).json({
    error: 'Server video uploads are disabled. Stream directly from your device using WebRTC P2P.',
  });
});

export default router;
