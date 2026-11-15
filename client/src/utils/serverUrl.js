export const DEFAULT_SERVER_URL = "https://watch-together-hl8e.onrender.com";

export function isDesktopApp() {
  if (typeof window === "undefined") return false;
  return Boolean(
    window.__TAURI_INTERNALS__ ||
    window.__TAURI__ ||
    window.desktopAPI ||
    window.electronAPI ||
    window.location.protocol === "file:" ||
    window.location.hostname === "tauri.localhost"
  );
}

export function getServerUrl() {
  if (import.meta.env.VITE_SERVER_URL) {
    return import.meta.env.VITE_SERVER_URL.replace(/\/+$/, "");
  }
  if (isDesktopApp()) {
    return DEFAULT_SERVER_URL;
  }
  return "";
}

export default getServerUrl;
