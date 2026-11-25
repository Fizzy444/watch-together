import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { HLS_DIR } from '../config.js';

export function probeMedia(moviePath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name:stream_tags=language,title:stream_disposition=default',
      '-of', 'json',
      moviePath,
    ];

    const proc = spawn('ffprobe', args);
    let stdout = '';

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return resolve({ audioTracks: [], subtitleTracks: [] });
      }

      try {
        const parsed = JSON.parse(stdout);
        const streams = parsed.streams || [];
        const audioTracks = streams
          .filter((s) => s.codec_type === 'audio')
          .map((s, idx) => ({
            streamIndex: s.index ?? idx,
            codec: s.codec_name || 'aac',
            language: s.tags?.language || s.tags?.LANGUAGE || 'und',
            title: s.tags?.title || s.tags?.TITLE || null,
            isDefault: s.disposition?.default === 1 || idx === 0,
          }));

        const subtitleTracks = streams
          .filter((s) => s.codec_type === 'subtitle')
          .map((s, idx) => {
            const lang = s.tags?.language || s.tags?.LANGUAGE || 'und';
            const title = s.tags?.title || s.tags?.TITLE || null;
            const label = title
              ? (lang !== 'und' ? `${title} (${lang.toUpperCase()})` : title)
              : (lang !== 'und' ? `Subtitle ${idx + 1} (${lang.toUpperCase()})` : `Subtitle ${idx + 1}`);

            return {
              id: `sub-${idx}`,
              streamIndex: s.index ?? idx,
              language: lang,
              title,
              label,
              isDefault: s.disposition?.default === 1 || idx === 0,
            };
          });

        resolve({ audioTracks, subtitleTracks });
      } catch {
        resolve({ audioTracks: [], subtitleTracks: [] });
      }
    });

    proc.on('error', () => {
      resolve({ audioTracks: [], subtitleTracks: [] });
    });
  });
}

/**
 * Transcode a movie file to HLS format using FFmpeg.
 * If HLS output already exists, resolves immediately (skip re-transcode).
 * @param {string} moviePath  - Absolute path to the source movie file
 * @param {string} roomId     - Room ID used as subdirectory name
 * @returns {Promise<string>} - Resolves with path to index.m3u8
 */
export async function transcodeToHLS(moviePath, roomId) {
  const outputDir = path.join(HLS_DIR, roomId);
  const playlist = path.join(outputDir, 'index.m3u8');

  if (fs.existsSync(playlist)) {
    console.log(`[FFmpeg] HLS already exists for room ${roomId}, skipping.`);
    return playlist;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const { audioTracks, subtitleTracks } = await probeMedia(moviePath);
  console.log(`[FFmpeg] Transcoding ${path.basename(moviePath)} for room ${roomId} (${audioTracks.length} audio track(s), ${subtitleTracks.length} subtitle track(s))...`);

  // Extract all subtitle streams to WebVTT files in parallel
  const defaultVtt = path.join(outputDir, 'subtitles.vtt');
  const subPromises = subtitleTracks.map((sub, idx) => {
    const filename = `subtitles_${idx}_${sub.language}.vtt`;
    const vttPath = path.join(outputDir, filename);
    return new Promise((res) => {
      const subProc = spawn('ffmpeg', [
        '-y',
        '-v', 'error',
        '-i', moviePath,
        '-map', `0:${sub.streamIndex}`,
        '-f', 'webvtt',
        vttPath,
      ]);
      subProc.on('close', res);
      subProc.on('error', res);
    });
  });

  subPromises.push(
    new Promise((res) => {
      const subProc = spawn('ffmpeg', [
        '-y',
        '-v', 'error',
        '-i', moviePath,
        '-map', '0:s:0?',
        '-f', 'webvtt',
        defaultVtt,
      ]);
      subProc.on('close', res);
      subProc.on('error', res);
    })
  );

  await Promise.all(subPromises);

  const availableSubtitles = [];
  for (const [idx, sub] of subtitleTracks.entries()) {
    const filename = `subtitles_${idx}_${sub.language}.vtt`;
    const vttPath = path.join(outputDir, filename);
    if (fs.existsSync(vttPath) && fs.statSync(vttPath).size > 10) {
      availableSubtitles.push({
        id: `sub-${idx}`,
        streamIndex: sub.streamIndex,
        language: sub.language,
        label: sub.label,
        url: `/api/rooms/${roomId}/stream/${filename}`,
        isDefault: sub.isDefault,
      });
    }
  }

  if (availableSubtitles.length === 0 && fs.existsSync(defaultVtt) && fs.statSync(defaultVtt).size > 10) {
    availableSubtitles.push({
      id: 'sub-default',
      streamIndex: 0,
      language: 'und',
      label: 'Default Subtitles',
      url: `/api/rooms/${roomId}/stream/subtitles.vtt`,
      isDefault: true,
    });
  }

  try {
    fs.writeFileSync(path.join(outputDir, 'subtitles.json'), JSON.stringify(availableSubtitles, null, 2));
  } catch {}

  return new Promise((resolve, reject) => {
    let args = [
      '-y',
      '-i', moviePath,
      '-map', '0:v:0',
    ];

    if (audioTracks.length > 1) {
      audioTracks.forEach((t) => {
        args.push('-map', `0:${t.streamIndex}`);
      });

      const varStreamParts = ['v:0,agroup:audio'];
      audioTracks.forEach((track, idx) => {
        const lang = track.language === 'und' ? 'und' : track.language;
        const defaultStr = track.isDefault || idx === 0 ? 'yes' : 'no';
        const cleanName = (track.title || track.language || `audio_${idx + 1}`).replace(/[^a-zA-Z0-9_]/g, '_');
        varStreamParts.push(`a:${idx},agroup:audio,language:${lang},name:${cleanName},default:${defaultStr}`);
      });

      args.push(
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ac', '2',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_flags', 'independent_segments',
        '-master_pl_name', 'index.m3u8',
        '-var_stream_map', varStreamParts.join(' '),
        '-hls_segment_filename', path.join(outputDir, 'seg_%v_%03d.ts'),
        '-f', 'hls',
        path.join(outputDir, 'variant_%v.m3u8')
      );
    } else {
      args.push(
        '-map', '0:a:0?',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ac', '2',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_filename', path.join(outputDir, 'seg%03d.ts'),
        '-f', 'hls',
        playlist
      );
    }

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
