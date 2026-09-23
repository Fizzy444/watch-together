import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.resolve(__dirname, "../../data/users.json");

// Ensure data folder exists
fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });

/**
 * @typedef {Object} StoredUser
 * @property {string} id
 * @property {string} username
 * @property {string} salt
 * @property {string} hash
 * @property {number} createdAt
 */

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const data = fs.readFileSync(USERS_FILE, "utf8");
    return JSON.parse(data) || [];
  } catch (err) {
    console.error("[UserManager] Error loading users:", err.message);
    return [];
  }
}

function saveUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
  } catch (err) {
    console.error("[UserManager] Error saving users:", err.message);
  }
}

// In-memory active sessions Map<token, { userId, username, createdAt }>
const sessions = new Map();

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password, salt, storedHash) {
  const hash = hashPassword(password, salt);
  const bufA = Buffer.from(hash, "hex");
  const bufB = Buffer.from(storedHash, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    createdAt: Date.now(),
  });
  return token;
}

export function getUserByToken(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  return { id: session.userId, username: session.username };
}

export function revokeToken(token) {
  if (token) {
    sessions.delete(token);
  }
}

export function createUser(username, password) {
  const cleanUsername = (username || "").trim();
  const cleanPassword = (password || "").trim();

  if (!cleanUsername) {
    throw new Error("Username is required");
  }
  if (cleanUsername.length < 3) {
    throw new Error("Username must be at least 3 characters");
  }
  if (cleanUsername.length > 30) {
    throw new Error("Username must not exceed 30 characters");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanUsername)) {
    throw new Error("Username can only contain letters, numbers, hyphens, and underscores");
  }
  if (!cleanPassword) {
    throw new Error("Password is required");
  }
  if (cleanPassword.length < 4) {
    throw new Error("Password must be at least 4 characters");
  }

  const users = loadUsers();
  const existing = users.find((u) => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (existing) {
    throw new Error("Username is already taken");
  }

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(cleanPassword, salt);
  const id = crypto.randomUUID();

  const newUser = {
    id,
    username: cleanUsername,
    salt,
    hash,
    createdAt: Date.now(),
  };

  users.push(newUser);
  saveUsers(users);

  console.log(`[UserManager] Created new user: ${cleanUsername} (${id})`);
  const token = createSession(newUser);
  return {
    user: { id, username: cleanUsername, createdAt: newUser.createdAt },
    token,
  };
}

export function authenticateUser(username, password) {
  const cleanUsername = (username || "").trim();
  const cleanPassword = (password || "").trim();

  if (!cleanUsername || !cleanPassword) {
    throw new Error("Username and password are required");
  }

  const users = loadUsers();
  const user = users.find((u) => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (!user) {
    throw new Error("Invalid username or password");
  }

  const isValid = verifyPassword(cleanPassword, user.salt, user.hash);
  if (!isValid) {
    throw new Error("Invalid username or password");
  }

  const token = createSession(user);
  return {
    user: { id: user.id, username: user.username, createdAt: user.createdAt },
    token,
  };
}
