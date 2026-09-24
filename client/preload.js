const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startTorrent: (magnetLink) => ipcRenderer.invoke('start-torrent', magnetLink),
  stopTorrent: () => ipcRenderer.invoke('stop-torrent'),
  onTorrentProgress: (callback) => ipcRenderer.on('torrent-progress', (event, data) => callback(data)),
  onTorrentError: (callback) => ipcRenderer.on('torrent-error', (event, err) => callback(err)),
});
