const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startTorrent: (magnetLink) => ipcRenderer.invoke('start-torrent', magnetLink),
  stopTorrent: () => ipcRenderer.invoke('stop-torrent'),
  onTorrentProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('torrent-progress', handler);
    return () => ipcRenderer.removeListener('torrent-progress', handler);
  },
  onTorrentError: (callback) => {
    const handler = (_event, err) => callback(err);
    ipcRenderer.on('torrent-error', handler);
    return () => ipcRenderer.removeListener('torrent-error', handler);
  },
});
