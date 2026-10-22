process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');

// Ensure Chromium allows unmuted audio autoplay without requiring initial user gestures
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn, execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const cloudflared = require('cloudflared');
const { Tunnel } = cloudflared;

// Resolve cloudflared binary outside of app.asar to prevent "spawn ENOTDIR"
function resolveCloudflaredBinary() {
  let binPath = cloudflared.bin;
  if (binPath && binPath.includes("app.asar")) {
    const unpacked = binPath.replace("app.asar", "app.asar.unpacked");
    if (fs.existsSync(unpacked)) {
      return unpacked;
    }
    const binName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
    const altPath = path.join(app.getAppPath(), "..", "app.asar.unpacked", "node_modules", "cloudflared", "bin", binName);
    if (fs.existsSync(altPath)) {
      return altPath;
    }
  }
  if (process.platform !== "win32") {
    if (fs.existsSync("/usr/bin/cloudflared")) return "/usr/bin/cloudflared";
    if (fs.existsSync("/usr/local/bin/cloudflared")) return "/usr/local/bin/cloudflared";
  }
  return binPath;
}

try {
  const resolvedBin = resolveCloudflaredBinary();
  if (resolvedBin) {
    if (process.platform !== "win32" && fs.existsSync(resolvedBin)) {
      try { fs.chmodSync(resolvedBin, 0o755); } catch {}
    }
    console.log("[Host Tunnel] Configured cloudflared binary:", resolvedBin);
    cloudflared.use(resolvedBin);
  }
} catch (e) {
  console.warn("[Host Tunnel] Failed to resolve unpacked cloudflared binary:", e);
}

let WebTorrent;
async function getWebTorrent() {
  if (!WebTorrent) {
    const mod = await import('webtorrent');
    WebTorrent = mod.default || mod;
  }
  return WebTorrent;
}

const MODERN_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
];

let mainWindow;
let webtorrentClient = null;
let torrentServer = null;
let currentActiveMagnet = null;
let currentStreamData = null;
let currentTorrent = null;
let pendingResolvers = [];
let progressInterval = null;
let stopGraceTimer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  // Allow toggling DevTools with Ctrl+Shift+I or F12 for debugging
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i") || input.key === "F12") {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Electron] Failed to load ${validatedURL}: ${errorCode} - ${errorDescription}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanupTorrent();
    cleanupHostTunnel();
  });
}

function stopProgressInterval() {
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

function cleanupTorrent() {
  if (stopGraceTimer) {
    clearTimeout(stopGraceTimer);
    stopGraceTimer = null;
  }
  stopProgressInterval();

  if (pendingResolvers.length > 0) {
    const err = new Error('Torrent cancelled');
    for (const { reject } of pendingResolvers) {
      reject(err);
    }
    pendingResolvers = [];
  }

  currentActiveMagnet = null;
  currentStreamData = null;
  currentTorrent = null;

  if (torrentServer) {
    try {
      torrentServer.close();
    } catch (e) {
      console.error('Error closing torrent server:', e);
    }
    torrentServer = null;
  }
  if (webtorrentClient) {
    try {
      webtorrentClient.destroy();
    } catch (e) {
      console.error('Error destroying webtorrent client:', e);
    }
    webtorrentClient = null;
  }
}

app.whenReady().then(async () => {
  try {
    await getWebTorrent();
  } catch (err) {
    console.error('Failed to pre-load WebTorrent:', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC: Start Torrent
ipcMain.handle('start-torrent', async (event, magnetLink) => {
  if (stopGraceTimer) {
    clearTimeout(stopGraceTimer);
    stopGraceTimer = null;
  }

  // If already streaming this exact torrent, return existing stream immediately
  if (currentActiveMagnet === magnetLink && currentStreamData) {
    console.log('[Torrent] Returning already active stream for', currentStreamData.fileName);
    return currentStreamData;
  }

  // If currently initializing this exact torrent, attach to pending promise
  if (currentActiveMagnet === magnetLink && pendingResolvers.length > 0) {
    console.log('[Torrent] Attaching to in-flight start-torrent for magnet');
    return new Promise((resolve, reject) => {
      pendingResolvers.push({ resolve, reject });
    });
  }

  // If switching to a different torrent, clean up first
  if (currentActiveMagnet && currentActiveMagnet !== magnetLink) {
    cleanupTorrent();
  }

  currentActiveMagnet = magnetLink;

  const WebTorrentClass = await getWebTorrent();

  return new Promise((resolve, reject) => {
    pendingResolvers.push({ resolve, reject });

    const finishSuccess = (data) => {
      currentStreamData = data;
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      for (const r of resolvers) {
        r.resolve(data);
      }
    };

    const finishError = (err) => {
      const resolvers = pendingResolvers;
      pendingResolvers = [];
      for (const r of resolvers) {
        r.reject(err);
      }
      cleanupTorrent();
    };

    try {
      if (!webtorrentClient) {
        webtorrentClient = new WebTorrentClass();
        webtorrentClient.on('error', (err) => {
          console.error('WebTorrent Error:', err);
          event.sender.send('torrent-error', err.message);
        });
      }

      if (!torrentServer) {
        torrentServer = webtorrentClient.createServer();
        if (torrentServer && torrentServer.server) {
          torrentServer.server.on('error', (err) => {
            console.error('Torrent server error:', err);
          });
        }
      }

      torrentServer.listen(0, () => {
        const port = torrentServer.address().port;
        console.log('WebTorrent streaming server listening on port', port);

        console.log('[Torrent] Adding magnet link with modern fallback trackers...');
        const torrent = webtorrentClient.add(magnetLink, {
          announce: MODERN_TRACKERS,
        });
        currentTorrent = torrent;

        // Periodic heartbeat so UI always gets live download/swarm stats
        stopProgressInterval();
        progressInterval = setInterval(() => {
          if (!torrent || torrent.destroyed) return;
          try {
            event.sender.send('torrent-progress', {
              progress: torrent.progress || 0,
              downloadSpeed: torrent.downloadSpeed || 0,
              numPeers: torrent.numPeers || 0,
              hasMetadata: Boolean(torrent.files && torrent.files.length > 0),
              downloaded: torrent.downloaded || 0,
              total: torrent.length || 0,
            });
          } catch {}
        }, 1000);

        torrent.on('error', (err) => {
          console.error('Torrent Error:', err);
          event.sender.send('torrent-error', err.message);
          finishError(err);
        });

        torrent.on('wire', () => {
          try {
            event.sender.send('torrent-progress', {
              progress: torrent.progress,
              downloadSpeed: torrent.downloadSpeed,
              numPeers: torrent.numPeers,
              hasMetadata: Boolean(torrent.files && torrent.files.length > 0),
            });
          } catch {}
        });

        torrent.on('ready', () => {
          console.log('Torrent ready, files found:', torrent.files.length);

          const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v', '.ts', '.m2ts'];
          const videoFiles = torrent.files.filter(f => {
            const ext = path.extname(f.name).toLowerCase();
            return VIDEO_EXTENSIONS.includes(ext);
          });

          let targetFile = null;
          if (videoFiles.length > 0) {
            targetFile = videoFiles.reduce((prev, curr) => curr.length > prev.length ? curr : prev);
          } else {
            const largest = torrent.files.reduce((prev, curr) => curr.length > prev.length ? curr : prev);
            const ext = path.extname(largest.name).toLowerCase();
            if (['.iso', '.rar', '.zip', '.bin', '.img', '.7z'].includes(ext)) {
              const errorMsg = `This torrent contains an unsupported disk image or archive (${largest.name}). HTML5 video players cannot stream raw disk images (.iso). Please use a torrent containing a direct video file (.mp4, .mkv, .webm).`;
              console.error(errorMsg);
              event.sender.send('torrent-error', errorMsg);
              finishError(new Error(errorMsg));
              return;
            }
            targetFile = largest;
          }

          const streamUrl = 'http://localhost:' + port + targetFile.streamURL;
          console.log('Streaming', targetFile.name, 'at', streamUrl);

          finishSuccess({
            streamUrl,
            fileName: targetFile.name,
            length: targetFile.length,
          });
        });
      });
    } catch (err) {
      finishError(err);
    }
  });
});

ipcMain.handle('stop-torrent', () => {
  // Grace period so React StrictMode quick unmount/remount does not kill the stream!
  if (stopGraceTimer) clearTimeout(stopGraceTimer);
  stopGraceTimer = setTimeout(() => {
    console.log('[Torrent] Grace period expired. Stopping torrent stream.');
    cleanupTorrent();
    stopGraceTimer = null;
  }, 2000);
  return true;
});


// Host Local Streaming & Cloudflare Tunnel
let hostVideoServer = null;
let hostCloudflareTunnel = null;
let hostFfmpegProcess = null;
let hostHlsDir = null;
let currentHostVideoPath = null;

function cleanupHostTunnel() {
  if (hostFfmpegProcess) {
    try {
      console.log('[Host Stream] Killing ffmpeg transcode process...');
      hostFfmpegProcess.kill('SIGKILL');
    } catch (e) {
      console.error('Error killing ffmpeg:', e);
    }
    hostFfmpegProcess = null;
  }
  if (hostHlsDir) {
    try {
      console.log('[Host Stream] Removing HLS temp directory:', hostHlsDir);
      fs.rmSync(hostHlsDir, { recursive: true, force: true });
    } catch (e) {
      console.error('Error deleting HLS temp directory:', e);
    }
    hostHlsDir = null;
  }
  if (hostCloudflareTunnel) {
    try {
      console.log('[Host Tunnel] Stopping Cloudflare Tunnel...');
      hostCloudflareTunnel.stop();
    } catch (e) {
      console.error('Error stopping cloudflare tunnel:', e);
    }
    hostCloudflareTunnel = null;
  }
  if (hostVideoServer) {
    try {
      console.log('[Host Server] Closing local video streaming server...');
      hostVideoServer.close();
    } catch (e) {
      console.error('Error closing host video server:', e);
    }
    hostVideoServer = null;
  }
}

async function probeVideoFile(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name',
      '-of', 'json',
      filePath,
    ]);
    const parsed = JSON.parse(stdout);
    const audioStreams = (parsed.streams || []).filter((s) => s.codec_type === 'audio');
    const videoStreams = (parsed.streams || []).filter((s) => s.codec_type === 'video');

    // Supported browser audio codecs: AAC, MP3, Opus, Vorbis, FLAC
    const BROWSER_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
    const hasUnsupportedAudio = audioStreams.some((s) => !BROWSER_AUDIO_CODECS.includes(s.codec_name?.toLowerCase()));
    const ext = path.extname(filePath).toLowerCase();
    const isMkv = ext === '.mkv';

    return {
      hasAudio: audioStreams.length > 0,
      audioCodec: audioStreams[0]?.codec_name || null,
      needsAudioTranscode: hasUnsupportedAudio,
      isMkv,
      videoCodec: videoStreams[0]?.codec_name || null,
    };
  } catch (err) {
    console.warn('[Host Stream] ffprobe error, falling back to direct stream:', err.message);
    const ext = path.extname(filePath).toLowerCase();
    return {
      hasAudio: true,
      audioCodec: null,
      needsAudioTranscode: false,
      isMkv: ext === '.mkv',
      videoCodec: null,
    };
  }
}

ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Video File to Stream',
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  currentHostVideoPath = filePath;
  const stat = fs.statSync(filePath);
  const bName = path.basename(filePath);
  return {
    filePath,
    name: bName,
    fileName: bName,
    size: stat.size,
    fileSize: stat.size,
  };
});

ipcMain.handle('start-host-tunnel', async (event, filePath) => {
  currentHostVideoPath = filePath;
  if (hostStopGraceTimer) {
    clearTimeout(hostStopGraceTimer);
    hostStopGraceTimer = null;
  }
  cleanupHostTunnel();

  if (!fs.existsSync(filePath)) {
    throw new Error('Selected video file does not exist: ' + filePath);
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  event.sender.send('host-tunnel-status', { step: 'analyzing-media', message: 'Analyzing video and audio tracks...' });
  const probe = await probeVideoFile(filePath);
  console.log('[Host Stream] Probe results for', fileName, ':', probe);

  // If audio is unsupported (AC-3, DTS, TrueHD, etc.) or container is MKV, remux to HLS with AAC audio
  const useHls = probe.needsAudioTranscode || probe.isMkv;

  let playlistPath = null;
  if (useHls) {
    event.sender.send('host-tunnel-status', { step: 'preparing-audio', message: 'Optimizing audio track (transcoding to stereo AAC)...' });
    hostHlsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-hls-'));
    playlistPath = path.join(hostHlsDir, 'index.m3u8');
    const segmentPattern = path.join(hostHlsDir, 'seg%03d.ts');

    const ffmpegArgs = [
      '-v', 'warning',
      '-i', filePath,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ac', '2',
      '-sn',
      '-hls_time', '3',
      '-hls_list_size', '0',
      '-hls_segment_filename', segmentPattern,
      '-f', 'hls',
      playlistPath,
    ];

    console.log('[Host Stream] Starting ffmpeg HLS remuxer:', ffmpegArgs.join(' '));
    hostFfmpegProcess = spawn('ffmpeg', ffmpegArgs);

    hostFfmpegProcess.stderr.on('data', (data) => {
      console.log('[FFmpeg]', data.toString().trim());
    });

    hostFfmpegProcess.on('error', (err) => {
      console.error('[FFmpeg Process Error]', err);
    });

    hostFfmpegProcess.on('exit', (code) => {
      console.log(`[FFmpeg] Exited with code ${code}`);
    });

    // Wait up to 10 seconds for index.m3u8 and the first segment to be generated
    const waitStart = Date.now();
    while (!fs.existsSync(playlistPath) || !fs.existsSync(path.join(hostHlsDir, 'seg000.ts'))) {
      if (Date.now() - waitStart > 10000) break;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  let contentType = 'video/mp4';
  if (ext === '.webm') contentType = 'video/webm';
  else if (ext === '.mkv') contentType = 'video/x-matroska';
  else if (ext === '.mov') contentType = 'video/quicktime';
  else if (ext === '.avi') contentType = 'video/x-msvideo';

  return new Promise((resolve, reject) => {
    event.sender.send('host-tunnel-status', { step: 'starting-server', message: 'Starting local video streaming server...' });

    hostVideoServer = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
      }

      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', file: fileName, size: fileSize, hls: useHls }));
      }

      // HLS Streaming Mode
      if (useHls) {
        if (req.url === '/index.m3u8' || req.url === '/video') {
          if (!fs.existsSync(playlistPath)) {
            res.writeHead(404);
            return res.end('Playlist not ready');
          }
          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          });
          const stream = fs.createReadStream(playlistPath);
          res.on('close', () => stream.destroy());
          return stream.pipe(res);
        }

        if (req.url.endsWith('.ts')) {
          const segName = path.basename(req.url);
          const segPath = path.join(hostHlsDir, segName);

          const sendSeg = () => {
            if (!fs.existsSync(segPath)) {
              res.writeHead(404);
              return res.end('Segment not found');
            }
            const segStat = fs.statSync(segPath);
            res.writeHead(200, {
              'Content-Type': 'video/MP2T',
              'Content-Length': segStat.size,
              'Cache-Control': 'public, max-age=86400',
            });
            const stream = fs.createReadStream(segPath);
            res.on('close', () => stream.destroy());
            stream.pipe(res);
          };

          if (!fs.existsSync(segPath)) {
            const waitPoll = Date.now();
            const interval = setInterval(() => {
              if (fs.existsSync(segPath) || Date.now() - waitPoll > 3000) {
                clearInterval(interval);
                sendSeg();
              }
            }, 100);
            return;
          } else {
            return sendSeg();
          }
        }
      }

      // Direct Progressive MP4 streaming mode with range requests
      const range = req.headers.range;
      const CHUNK_SIZE = 3 * 1024 * 1024; // 3MB chunks optimal for Cloudflare Tunnel

      if (req.method === 'HEAD') {
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          let end = parts[1] ? parseInt(parts[1], 10) : start + CHUNK_SIZE - 1;
          if (end >= fileSize) end = fileSize - 1;
          const chunksize = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
          });
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Accept-Ranges': 'bytes',
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
          });
        }
        return res.end();
      }

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        let end = parts[1] ? parseInt(parts[1], 10) : start + CHUNK_SIZE - 1;
        if (end - start + 1 > CHUNK_SIZE) end = start + CHUNK_SIZE - 1;
        if (end >= fileSize) end = fileSize - 1;

        if (start >= fileSize) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
          return res.end();
        }

        const chunksize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        });

        const stream = fs.createReadStream(filePath, { start, end });
        res.on('close', () => stream.destroy());
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=3600',
        });
        const stream = fs.createReadStream(filePath);
        res.on('close', () => stream.destroy());
        stream.pipe(res);
      }
    });

    hostVideoServer.listen(0, '127.0.0.1', () => {
      const port = hostVideoServer.address().port;
      console.log(`[Host Server] Video stream ready on local port ${port} (mode: ${useHls ? 'HLS' : 'Direct'})`);

      event.sender.send('host-tunnel-status', { step: 'creating-tunnel', message: 'Creating secure Cloudflare tunnel...' });

      try {
        hostCloudflareTunnel = Tunnel.quick(`http://127.0.0.1:${port}`);

        hostCloudflareTunnel.once('url', (tunnelUrl) => {
          console.log(`[Host Tunnel] Cloudflare Tunnel established: ${tunnelUrl}`);
          const streamUrl = useHls ? `${tunnelUrl}/index.m3u8` : `${tunnelUrl}/video`;
          const localStreamUrl = useHls ? `http://127.0.0.1:${port}/index.m3u8` : `http://127.0.0.1:${port}/video`;

          event.sender.send('host-tunnel-status', {
            step: 'ready',
            message: 'Tunnel connected! Ready to stream.',
            streamUrl,
          });

          resolve({
            streamUrl,
            localStreamUrl,
            tunnelUrl,
            fileName,
            fileSize,
            isHls: useHls,
          });
        });

        hostCloudflareTunnel.on('error', (err) => {
          console.error('[Host Tunnel] Error:', err);
          event.sender.send('host-tunnel-status', { step: 'error', message: err.message });
        });

        hostCloudflareTunnel.on('exit', (code) => {
          console.log(`[Host Tunnel] Exited with code ${code}`);
        });
      } catch (err) {
        cleanupHostTunnel();
        reject(err);
      }
    });

    hostVideoServer.on('error', (err) => {
      console.error('[Host Server] Error:', err);
      cleanupHostTunnel();
      reject(err);
    });
  });
});

let hostStopGraceTimer = null;

ipcMain.handle('stop-host-tunnel', () => {
  if (hostStopGraceTimer) clearTimeout(hostStopGraceTimer);
  hostStopGraceTimer = setTimeout(() => {
    console.log('[Host Tunnel] Grace period expired. Stopping host stream.');
    cleanupHostTunnel();
    hostStopGraceTimer = null;
  }, 2500);
  return true;
});

// Subtitles & Captions IPC Handlers
ipcMain.handle('find-matching-subtitles', async (_event, videoPath) => {
  const targetPath = videoPath || currentHostVideoPath;
  if (!targetPath || !fs.existsSync(targetPath)) {
    return [];
  }

  const results = [];

  // 1. Extract embedded subtitle tracks from container using ffprobe & ffmpeg
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 's',
      '-show_entries', 'stream=index,codec_name:stream_tags=language,title',
      '-of', 'json',
      targetPath,
    ]);
    const parsed = JSON.parse(stdout);
    const streams = parsed.streams || [];
    for (let i = 0; i < streams.length; i++) {
      const s = streams[i];
      try {
        const { stdout: vtt } = await execFileAsync('ffmpeg', [
          '-v', 'error',
          '-i', targetPath,
          '-map', `0:${s.index}`,
          '-f', 'webvtt',
          '-',
        ], { maxBuffer: 10 * 1024 * 1024 });

        if (vtt && vtt.trim().length > 0) {
          const lang = s.tags?.language || s.tags?.LANGUAGE || 'und';
          const title = s.tags?.title || s.tags?.TITLE || (lang !== 'und' ? `Track ${i + 1} (${lang.toUpperCase()})` : `Embedded Track ${i + 1}`);
          results.push({
            fileName: title,
            filePath: targetPath,
            format: 'vtt',
            content: vtt,
            isEmbedded: true,
            streamIndex: s.index,
            trackNumber: i + 1,
            language: lang,
            title,
          });
        }
      } catch (extractErr) {
        console.warn(`[Subtitles] Could not extract stream ${s.index} (${s.codec_name}):`, extractErr.message);
      }
    }
  } catch (probeErr) {
    console.warn('[Subtitles] Embedded stream probe failed:', probeErr.message);
  }

  // 2. Scan folder for local matching .srt or .vtt files with same name
  try {
    const dir = path.dirname(targetPath);
    const videoExt = path.extname(targetPath);
    const videoBase = path.basename(targetPath, videoExt).toLowerCase();

    const files = fs.readdirSync(dir);
    const SUB_EXTS = ['.srt', '.vtt'];

    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (!SUB_EXTS.includes(ext)) continue;

      const subBase = path.basename(f, ext).toLowerCase();
      // Match exact basename or prefix match (e.g. Inception.srt, Inception.en.srt, Inception-eng.vtt)
      if (subBase === videoBase || subBase.startsWith(videoBase)) {
        const fullPath = path.join(dir, f);
        const content = fs.readFileSync(fullPath, 'utf8');
        results.push({
          fileName: f,
          filePath: fullPath,
          format: ext.replace('.', ''),
          content,
          isEmbedded: false,
          isAutoDetected: true,
        });
      }
    }
  } catch (err) {
    console.error('Error finding matching subtitles:', err);
  }

  return results;
});

ipcMain.handle('select-subtitle-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Subtitle File (.srt, .vtt)',
    properties: ['openFile'],
    filters: [
      { name: 'Subtitle Files', extensions: ['srt', 'vtt'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  const content = fs.readFileSync(filePath, 'utf8');
  return {
    filePath,
    fileName,
    format: ext,
    content,
  };
});

