import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { PORT, HOST, HLS_DIR } from './config.js';
import moviesRouter from './routes/movies.js';
import roomsRouter from './routes/rooms.js';
import authRouter from './routes/auth.js';
import { handleConnection } from './ws/handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');

// Clean up any stale HLS directories on startup to ensure zero disk clutter
if (fs.existsSync(HLS_DIR)) {
  try {
    for (const entry of fs.readdirSync(HLS_DIR)) {
      fs.rmSync(path.join(HLS_DIR, entry), { recursive: true, force: true });
    }
  } catch {}
}

const app = express();

// Open CORS so clients connecting via IPv6, localhost, or LAN work seamlessly
app.use(cors());

// Gzip compression for API responses and static assets
app.use(compression({
  filter: (req, res) => {
    // Never compress video endpoints or range requests
    if (req.headers.range || req.path.includes('/video') || req.path.includes('/stream')) {
      return false;
    }
    return compression.filter(req, res);
  }
}));
app.use(express.json());

// API routes
app.use('/api/movies', moviesRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/auth', authRouter);

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Serve built frontend if available (single-port unified serving for IPv6 / remote)
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// Create HTTP server and attach WebSocket server
const server = createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', handleConnection);

// Helper to find global IPv6 addresses
function getGlobalIPv6Addresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // IPv6, not loopback, not link-local (fe80::)
      if (net.family === 'IPv6' && !net.internal && !net.address.toLowerCase().startsWith('fe80')) {
        addresses.push({ iface: name, address: net.address });
      }
    }
  }
  return addresses;
}

// Bind to '::' (dual-stack: all IPv6 and IPv4 interfaces)
server.listen(PORT, HOST, () => {
  const ipv6List = getGlobalIPv6Addresses();
  console.log(`\n🎬 Watch Together server running on PORT ${PORT}`);
  console.log(`   Local IPv4:  http://localhost:${PORT}`);
  console.log(`   Local IPv6:  http://[::1]:${PORT}`);

  if (ipv6List.length > 0) {
    console.log(`\n🌐 Public IPv6 Addresses (Share with friends):`);
    for (const { iface, address } of ipv6List) {
      console.log(`   [${iface}]  http://[${address}]:${PORT}`);
    }
  } else {
    console.log(`   ⚠️ No public IPv6 address detected on active interfaces.`);
  }
  console.log(`\n   WebSocket endpoint: /ws\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] Shutting down...');
  server.close(() => process.exit(0));
});
