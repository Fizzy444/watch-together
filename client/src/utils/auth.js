import { saveProfileName } from "./profile.js";
import { getServerUrl } from "./serverUrl.js";

const SERVER_URL = getServerUrl();

const TOKEN_KEY = "wt_auth_token";
const USER_KEY = "wt_auth_user";

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(user, token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      saveProfileName(user.username);
    }
    window.dispatchEvent(new CustomEvent("wt-auth-changed", { detail: { user, token } }));
  } catch {}
}

export function clearStoredAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    window.dispatchEvent(new CustomEvent("wt-auth-changed", { detail: { user: null, token: null } }));
  } catch {}
}

export async function signupApi(username, password) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Failed to sign up");
    }
    setStoredAuth(data.user, data.token);
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Server request timed out. Please check your connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function loginApi(username, password) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Failed to sign in");
    }
    setStoredAuth(data.user, data.token);
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("Server request timed out. Please check your connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchCurrentUserApi() {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const res = await fetch(`${SERVER_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      clearStoredAuth();
      return null;
    }
    const data = await res.json();
    setStoredAuth(data.user, token);
    return data.user;
  } catch {
    return null;
  }
}

export async function logoutApi() {
  const token = getStoredToken();
  if (token) {
    fetch(`${SERVER_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  clearStoredAuth();
}
