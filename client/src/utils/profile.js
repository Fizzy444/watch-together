const PROFILE_KEY = 'wt_display_name';

/**
 * Get the stored display name from localStorage (or empty string if not set).
 * No default name like "Host" or "Guest".
 */
export function getProfileName() {
  const name = localStorage.getItem(PROFILE_KEY);
  return name && name.trim() ? name.trim() : '';
}

/**
 * Save display name to localStorage.
 */
export function saveProfileName(name) {
  const trimmed = (name || '').trim();
  if (trimmed) {
    localStorage.setItem(PROFILE_KEY, trimmed);
  }
  return trimmed;
}

/**
 * Clear stored display name.
 */
export function clearProfileName() {
  localStorage.removeItem(PROFILE_KEY);
}
