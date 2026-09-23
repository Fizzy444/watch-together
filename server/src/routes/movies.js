import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { MEDIA_DIR, ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES } from '../config.js';

const router = express.Router();

// Ensure media dir exists
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Multer storage — save to MEDIA_DIR with original sanitized name
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename: (_req, file, cb) => {
    // Sanitize: replace spaces with underscores, strip non-alphanumeric chars except dot/dash/underscore
    const safe = file.originalname
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
    cb(null, safe);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext) && ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 * 1024 }, // 20 GB max
});

/** Helper — scan MEDIA_DIR and return movie objects */
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// GET /api/movies — list available movies
router.get('/', (_req, res) => {
  res.json(listMovies());
});

// POST /api/movies/upload — upload a new movie file
router.post('/upload', upload.single('movie'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({
    message: 'Upload successful',
    file: req.file.filename,
    movies: listMovies(),
  });
});

// Error handler for multer
router.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message });
});

export default router;
