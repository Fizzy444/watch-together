import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);

export const desktopAPI = {
  isTauri: true,

  selectVideoFile: async () => {
    return await invoke('select_video_file');
  },

  startHostTunnel: async (filePath, streamMode = 'auto') => {
    return await invoke('start_host_tunnel', { filePath, streamMode });
  },

  seekHlsStream: async (targetSeconds) => {
    return await invoke('seek_hls_stream', { targetSeconds });
  },

  stopHostTunnel: async () => {
    return await invoke('stop_host_tunnel');
  },

  onTunnelStatus: (callback) => {
    let unlistenFn = null;
    let cancelled = false;
    listen('host-tunnel-status', (event) => {
      if (!cancelled && callback) callback(event.payload);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    }).catch((err) => {
      console.warn('Failed to listen to host-tunnel-status:', err);
    });

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  },

  selectSubtitleFile: async () => {
    return await invoke('select_subtitle_file');
  },

  findMatchingSubtitles: async (videoPath) => {
    return await invoke('find_matching_subtitles', { videoPath });
  },

  startTorrent: async (magnetLink) => {
    return await invoke('start_torrent', { magnetLink });
  },

  stopTorrent: async () => {
    return await invoke('stop_torrent');
  },

  onTorrentProgress: (callback) => {
    let unlistenFn = null;
    let cancelled = false;
    listen('torrent-progress', (event) => {
      if (!cancelled && callback) callback(event.payload);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    }).catch((err) => {
      console.warn('Failed to listen to torrent-progress:', err);
    });

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  },

  onTorrentError: (callback) => {
    let unlistenFn = null;
    let cancelled = false;
    listen('torrent-error', (event) => {
      if (!cancelled && callback) callback(event.payload);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenFn = unlisten;
      }
    }).catch((err) => {
      console.warn('Failed to listen to torrent-error:', err);
    });

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  },

  minimizeWindow: async () => {
    return await invoke('window_minimize');
  },

  toggleMaximizeWindow: async () => {
    return await invoke('window_toggle_maximize');
  },

  closeWindow: async () => {
    return await invoke('window_close');
  },

  isWindowMaximized: async () => {
    return await invoke('window_is_maximized');
  },
};

if (typeof window !== 'undefined' && isTauri) {
  window.desktopAPI = desktopAPI;
  window.electronAPI = desktopAPI;
}

export default desktopAPI;
