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

    torrentServer.on('error', (err) => {
      console.error('Torrent server error:', err);
    });

    torrentServer.listen(0, () => {
      const port = torrentServer.address().port;
      console.log('WebTorrent streaming server listening on port', port);

      const torrent = webtorrentClient.add(magnetLink);

      torrent.on('error', (err) => {
        console.error('Torrent Error:', err);
        event.sender.send('torrent-error', err.message);
        reject(err);
      });

      torrent.on('ready', () => {
        console.log('Torrent ready, files found:', torrent.files.length);
        let largestFile = torrent.files[0];
        for (let i = 1; i < torrent.files.length; i++) {
          if (torrent.files[i].length > largestFile.length) {
            largestFile = torrent.files[i];
          }
        }

        const streamUrl = 'http://localhost:' + port + largestFile.streamURL;
        console.log('Streaming', largestFile.name, 'at', streamUrl);

        resolve({
          streamUrl,
          fileName: largestFile.name,
          length: largestFile.length,
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
