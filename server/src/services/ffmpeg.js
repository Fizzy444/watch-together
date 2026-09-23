import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { HLS_DIR } from '../config.js';

/**
 * Transcode a movie file to HLS format using FFmpeg.
 * If HLS output already exists, resolves immediately (skip re-transcode).
 * @param {string} moviePath  - Absolute path to the source movie file
 * @param {string} roomId     - Room ID used as subdirectory name
 * @returns {Promise<string>} - Resolves with path to index.m3u8
 */
export function transcodeToHLS(moviePath, roomId) {
  return new Promise((resolve, reject) => {
    const outputDir = path.join(HLS_DIR, roomId);
    const playlist = path.join(outputDir, 'index.m3u8');

    // Skip if already transcoded
    if (fs.existsSync(playlist)) {
      console.log(`[FFmpeg] HLS already exists for room ${roomId}, skipping.`);
      return resolve(playlist);
    }

    fs.mkdirSync(outputDir, { recursive: true });

    console.log(`[FFmpeg] Transcoding ${path.basename(moviePath)} for room ${roomId}...`);

    const args = [
      '-i', moviePath,
      '-c', 'copy',
      '-hls_time', '6',
      '-hls_list_size', '0',
      '-hls_segment_filename', path.join(outputDir, 'seg%03d.ts'),
      '-f', 'hls',
      playlist,
    ];

    const ffmpeg = spawn('ffmpeg', args);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`[FFmpeg] Done transcoding room ${roomId}`);
        resolve(playlist);
      } else {
        console.error(`[FFmpeg] Error for room ${roomId}:\n${stderr}`);
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`Failed to start FFmpeg: ${err.message}`));
    });
  });
}

/**
 * Delete HLS output directory for a room.
 * @param {string} roomId
 */
export function cleanupHLS(roomId) {
  const outputDir = path.join(HLS_DIR, roomId);
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    console.log(`[FFmpeg] Cleaned up HLS for room ${roomId}`);
  }
}
