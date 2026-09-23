import express from "express";
import {
  createUser,
  authenticateUser,
  getUserByToken,
  revokeToken,
} from "../services/userManager.js";

const router = express.Router();

function getBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }
  return null;
}

// POST /api/auth/signup
router.post("/signup", (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = createUser(username, password);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post("/login", (req, res) => {
  try {
    const { username, password } = req.body || {};
    const result = authenticateUser(username, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get("/me", (req, res) => {
  const token = getBearerToken(req) || req.headers["x-auth-token"];
  if (!token) {
    return res.status(401).json({ error: "No authentication token provided" });
  }
  const user = getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: "Session expired or invalid" });
  }
  res.json({ user });
});

// POST /api/auth/logout
router.post("/logout", (req, res) => {
  const token = getBearerToken(req) || req.headers["x-auth-token"];
  if (token) {
    revokeToken(token);
  }
  res.json({ success: true, message: "Logged out" });
});

export default router;
