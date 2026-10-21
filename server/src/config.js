import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PORT = process.env.PORT || 3001;
export const HOST = process.env.HOST || "0.0.0.0";
export const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
export const MEDIA_DIR = path.resolve(__dirname, '..', 'media');
export const HLS_DIR = path.resolve(__dirname, '..', 'hls');

export const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.webm', '.mov'];
export const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/x-matroska',
  'video/avi',
  'video/webm',
  'video/quicktime',
];

export const ROOM_EXPIRY_MS = 6 * 60 * 60 * 1000; // 6 hours
// Auto turn-off empty rooms after 3 minutes (within requested 2-5 min range)
export const EMPTY_ROOM_EXPIRY_MS =
  parseInt(process.env.EMPTY_ROOM_EXPIRY_MS, 10) || 3 * 60 * 1000; // 3 minutes
export const SYNC_TICK_INTERVAL_MS = 10000;         // 10 seconds
