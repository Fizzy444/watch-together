process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Tunnel } = require('cloudflared');

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

function cleanupHostTunnel() {
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
        return res.end(JSON.stringify({ status: 'ok', file: fileName, size: fileSize }));
      }

      const range = req.headers.range;
      const CHUNK_SIZE = 3 * 1024 * 1024; // 3MB chunks optimal for Cloudflare Tunnel

      // Handle HEAD requests without writing a body (required by HTTP specs & HTML5 players)
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
      console.log(`[Host Server] Video stream ready on local port ${port}`);

      event.sender.send('host-tunnel-status', { step: 'creating-tunnel', message: 'Creating secure Cloudflare tunnel...' });

      try {
        hostCloudflareTunnel = Tunnel.quick(`http://127.0.0.1:${port}`);

        hostCloudflareTunnel.once('url', (tunnelUrl) => {
          console.log(`[Host Tunnel] Cloudflare Tunnel established: ${tunnelUrl}`);
          const streamUrl = `${tunnelUrl}/video`;

          event.sender.send('host-tunnel-status', {
            step: 'ready',
            message: 'Tunnel connected! Ready to stream.',
            streamUrl,
          });

          resolve({
            streamUrl,
            localStreamUrl: `http://127.0.0.1:${port}/video`,
            tunnelUrl,
            fileName,
            fileSize,
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
