const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const WebTorrent = require('webtorrent');

let mainWindow;
let webtorrentClient;
let torrentServer;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
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
    torrentServer.close();
    torrentServer = null;
  }
  if (webtorrentClient) {
    webtorrentClient.destroy();
    webtorrentClient = null;
  }
}

app.whenReady().then(() => {
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
  return new Promise((resolve, reject) => {
    cleanupTorrent();
    
    webtorrentClient = new WebTorrent();
    
    webtorrentClient.on('error', (err) => {
      console.error('WebTorrent Error:', err);
      event.sender.send('torrent-error', err.message);
    });

    webtorrentClient.add(magnetLink, (torrent) => {
      console.log('Client is downloading:', torrent.infoHash);

      torrentServer = torrent.createServer();
      torrentServer.listen(0, () => {
        const port = torrentServer.address().port;
        
        let largestFile = torrent.files[0];
        let fileIndex = 0;
        for (let i = 0; i < torrent.files.length; i++) {
          if (torrent.files[i].length > largestFile.length) {
            largestFile = torrent.files[i];
            fileIndex = i;
          }
        }
        
        console.log(`Streaming ${largestFile.name} on http://localhost:${port}/${fileIndex}`);
        
        resolve({
          streamUrl: `http://localhost:${port}/${fileIndex}`,
          fileName: largestFile.name,
          length: largestFile.length
        });
      });
      
      torrent.on('download', (bytes) => {
        event.sender.send('torrent-progress', {
          progress: torrent.progress,
          downloadSpeed: torrent.downloadSpeed,
          numPeers: torrent.numPeers
        });
      });
    });
  });
});

ipcMain.handle('stop-torrent', () => {
  cleanupTorrent();
  return true;
});
