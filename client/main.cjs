const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

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
