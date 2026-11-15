import crypto from "crypto";
import db from "../db.js";

const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;
const MIN_PASSWORD_LENGTH = 4;
const KEY_LENGTH_BYTES = 64;
const SALT_LENGTH_BYTES = 16;
const TOKEN_LENGTH_BYTES = 32;
const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

const findUserByUsernameStatement = db.prepare(
  "SELECT * FROM users WHERE username = ? COLLATE NOCASE"
);

const insertUserStatement = db.prepare(
  "INSERT INTO users (id, username, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)"
);

const insertSessionStatement = db.prepare(
  "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)"
);

const findSessionUserStatement = db.prepare(
  "SELECT u.id, u.username, u.created_at as createdAt FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ?"
);

const deleteSessionStatement = db.prepare(
  "DELETE FROM sessions WHERE token = ?"
);

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, KEY_LENGTH_BYTES).toString("hex");
}

function verifyPassword(password, salt, storedHash) {
  const hash = hashPassword(password, salt);
  const hashBuffer = Buffer.from(hash, "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");
  if (hashBuffer.length !== storedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(hashBuffer, storedBuffer);
}

function createSession(userId) {
  const token = crypto.randomBytes(TOKEN_LENGTH_BYTES).toString("hex");
  const now = Date.now();
  insertSessionStatement.run(token, userId, now);
  return token;
}

function validateCredentials(username, password) {
  const cleanUsername = (username || "").trim();
  const cleanPassword = (password || "").trim();

  if (!cleanUsername) {
    throw new Error("Username is required");
  }
  if (cleanUsername.length < MIN_USERNAME_LENGTH) {
    throw new Error(`Username must be at least ${MIN_USERNAME_LENGTH} characters`);
  }
  if (cleanUsername.length > MAX_USERNAME_LENGTH) {
    throw new Error(`Username must not exceed ${MAX_USERNAME_LENGTH} characters`);
  }
  if (!USERNAME_REGEX.test(cleanUsername)) {
    throw new Error("Username can only contain letters, numbers, hyphens, and underscores");
  }
  if (!cleanPassword) {
    throw new Error("Password is required");
  }
  if (cleanPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  return { cleanUsername, cleanPassword };
}

export function getUserByToken(token) {
  if (!token) {
    return null;
  }
  const row = findSessionUserStatement.get(token);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    username: row.username,
    createdAt: row.createdAt,
  };
}

export function revokeToken(token) {
  if (token) {
    deleteSessionStatement.run(token);
  }
}

export function createUser(username, password) {
  const { cleanUsername, cleanPassword } = validateCredentials(username, password);

  const existing = findUserByUsernameStatement.get(cleanUsername);
  if (existing) {
    throw new Error("Username is already taken");
  }

  const salt = crypto.randomBytes(SALT_LENGTH_BYTES).toString("hex");
  const hash = hashPassword(cleanPassword, salt);
  const id = crypto.randomUUID();
  const createdAt = Date.now();

  insertUserStatement.run(id, cleanUsername, salt, hash, createdAt);
  const token = createSession(id);

  return {
    user: { id, username: cleanUsername, createdAt },
    token,
  };
}

export function authenticateUser(username, password) {
  const cleanUsername = (username || "").trim();
  const cleanPassword = (password || "").trim();

  if (!cleanUsername || !cleanPassword) {
    throw new Error("Username and password are required");
  }

  const user = findUserByUsernameStatement.get(cleanUsername);
  if (!user) {
    throw new Error("Invalid username or password");
  }

  const isValid = verifyPassword(cleanPassword, user.salt, user.hash);
  if (!isValid) {
    throw new Error("Invalid username or password");
  }

  const token = createSession(user.id);
  return {
    user: { id: user.id, username: user.username, createdAt: user.created_at },
    token,
  };
}
