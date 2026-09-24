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

let mainWindow;
let webtorrentClient;
let torrentServer;

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

function cleanupTorrent() {
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
  const WebTorrentClass = await getWebTorrent();

  return new Promise((resolve, reject) => {
    cleanupTorrent();

    webtorrentClient = new WebTorrentClass();

    webtorrentClient.on('error', (err) => {
      console.error('WebTorrent Error:', err);
      event.sender.send('torrent-error', err.message);
    });

    torrentServer = webtorrentClient.createServer();

    if (torrentServer && torrentServer.server) {
      torrentServer.server.on('error', (err) => {
        console.error('Torrent server error:', err);
      });
    }

    torrentServer.listen(0, () => {
      const port = torrentServer.address().port;
      console.log('WebTorrent streaming server listening on port', port);

      const torrent = webtorrentClient.add(magnetLink);

      torrent.on('error', (err) => {
        console.error('Torrent Error:', err);
        event.sender.send('torrent-error', err.message);
        reject(err);
      });

      torrent.on('wire', () => {
        event.sender.send('torrent-progress', {
          progress: torrent.progress,
          downloadSpeed: torrent.downloadSpeed,
          numPeers: torrent.numPeers,
        });
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
            reject(new Error(errorMsg));
            return;
          }
          targetFile = largest;
        }

        const streamUrl = 'http://localhost:' + port + targetFile.streamURL;
        console.log('Streaming', targetFile.name, 'at', streamUrl);

        resolve({
          streamUrl,
          fileName: targetFile.name,
          length: targetFile.length,
        });
      });

      torrent.on('download', () => {
        event.sender.send('torrent-progress', {
          progress: torrent.progress,
          downloadSpeed: torrent.downloadSpeed,
          numPeers: torrent.numPeers,
        });
      });
    });
  });
});

ipcMain.handle('stop-torrent', () => {
  cleanupTorrent();
  return true;
});
