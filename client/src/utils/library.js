const USER_LIBRARY_KEY = "wt_user_library";

export function isLocalHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/**
 * Get array of filenames in this user's personal library.
 * Returns null if user is on localhost and has not customized yet (default to all on host machine).
 * Otherwise returns string[] array of filenames.
 */
export function getUserLibrary() {
  try {
    const raw = localStorage.getItem(USER_LIBRARY_KEY);
    if (raw === null) {
      if (isLocalHost()) {
        return null;
      }
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Check if a movie filename is in the current user's personal library.
 */
export function isMovieInUserLibrary(filename, allMovies = []) {
  if (!filename) return false;
  const lib = getUserLibrary();
  if (lib === null && isLocalHost()) {
    return true;
  }
  return (lib || []).includes(filename);
}

/**
 * Add a movie filename to this user's personal library.
 */
export function addMovieToUserLibrary(filename, allMovies = []) {
  if (!filename) return;
  try {
    let current = getUserLibrary();
    if (current === null) {
      current = allMovies.map((m) => m.filename);
    }
    if (!current.includes(filename)) {
      current = [...current, filename];
    }
    localStorage.setItem(USER_LIBRARY_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent("wt-library-changed", { detail: current }));
  } catch {}
}

/**
 * Remove a movie filename from this user's personal library.
 */
export function removeMovieFromUserLibrary(filename, allMovies = []) {
  if (!filename) return;
  try {
    let current = getUserLibrary();
    if (current === null) {
      current = allMovies.map((m) => m.filename);
    }
    const updated = current.filter((f) => f !== filename);
    localStorage.setItem(USER_LIBRARY_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("wt-library-changed", { detail: updated }));
  } catch {}
}
