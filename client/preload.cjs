const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // WebTorrent APIs
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

  // Automated Host Cloudflare Tunnel APIs
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  startHostTunnel: (filePath) => ipcRenderer.invoke('start-host-tunnel', filePath),
  stopHostTunnel: () => ipcRenderer.invoke('stop-host-tunnel'),
  onTunnelStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('host-tunnel-status', handler);
    return () => ipcRenderer.removeListener('host-tunnel-status', handler);
  },
});
