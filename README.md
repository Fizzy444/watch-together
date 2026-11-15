# Watch Together 🎬⚡

A private, frame-accurate, synchronized movie watching platform featuring **WebRTC Multi-User P2P Live Broadcasting**, **automated Cloudflare Quick Tunnels**, and a **lightweight Rust desktop app (Tauri v2)**.

Watch videos together with friends across cities, Wi-Fi, and cellular mobile data without buffering desync or complex setups.

---

## ✨ Features

- ⚡ **WebRTC P2P Multi-User Broadcasting (0 Server Upload)**:
  - Stream any local video file (`.mp4`, `.mkv`, `.webm`, `.mov`) directly from your computer or phone to multiple friends in real time.
  - Video data travels directly peer-to-peer (1-to-many star mesh) without touching or storing files on the server.
- 🦀 **Ultra-Lightweight Rust Desktop App (Tauri v2)**:
  - Native desktop application built with Rust and Tauri v2, replacing bulky Electron builds.
  - Minimal memory footprint (~35MB RAM) and tiny binary distribution (~10MB).
  - 1-Click Automated Cloudflare Quick Tunnel creation for streaming local media without port-forwarding.
  - On-the-fly faststart MP4 transmuxing and stereo AAC audio conversion with progress reporting.
  - Automatic embedded subtitle extraction and local `.srt`/`.vtt` file matching.
- 🌐 **STUN + TURN Relay Resilience**:
  - Direct UDP hole-punching via Google Public STUN (`stun:stun.l.google.com:19302`).
  - Automatic fallback to OpenRelay TURN to guarantee smooth connections even when friends are on restrictive 4G/5G cellular data with Carrier-Grade NAT (CGNAT).
- 🎞️ **Server Library Mode**:
  - Stream movies stored on the server using high-speed HTTP 206 Partial Content range requests (3MB progressive chunks) with zero disk bloat (no slicing into HLS duplicates).
- ⏱️ **Millisecond Playback Synchronization**:
  - WebSocket heartbeats continually coordinate playheads, pauses, and seeks.
  - **Smart Catch-Up Pause**: If a viewer has network lag when the host pauses, playback smoothly completes to the target timestamp instead of abruptly snapping.
- 💬 **In-Room Live Chat & Clean Top Bar**:
  - Real-time in-room chat with unread counters.
  - Clean dedicated top bar with one-click invite link copying (`🔗 Invite Link`) and host room management.
- 🔒 **Zero-Friction Authentication**:
  - Strictly Username and Password. No emails, no phone numbers, no tracking.
  - Persistent client session tokens and permanent usernames.

---

## 🛠️ Architecture

```
                    ┌────────────────────────────┐
                    │     Node.js Server         │
                    │  (Signaling, Rooms & API)  │
                    └─────────────┬──────────────┘
                                  │ WebSocket Signaling (Offer / Answer / ICE)
             ┌────────────────────┴────────────────────┐
             ▼                                         ▼
   [ Host (Rust Desktop App / Web) ]          [ Viewer 1 (Friend) ]
   - Tauri v2 (Rust) / React 19 Frontend      - Plays MediaStream live
   - Local HTTP 206 Server + Cloudflare Tunnel - Zero server video traffic
   - FFprobe / FFmpeg audio transcode
             │
             │ WebRTC SRTP/UDP (Encrypted P2P) or Cloudflare Tunnel
             ▼
   [ Viewer 2 (Friend) ]
   - Plays MediaStream live
```

- **Desktop Runtime**: Rust 1.90+, Tauri v2, Tokio, Axum (HTTP 206 Partial Content range server), RFD native dialogs.
- **Frontend**: React 19, Vite, Lucide Icons, Vanilla CSS (Cinema Dark design tokens).
- **Backend**: Node.js, Express, WebSocket (`ws`), Node Native Crypto (scrypt password hashing).
- **Video Traversal**: WebRTC (`RTCPeerConnection`), Google STUN, OpenRelay TURN, Cloudflare Quick Tunnels.

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm 9+
- Rust 1.90+ and Cargo (for desktop app development)
- FFmpeg and FFprobe (for host media transcoding and subtitle extraction)

### 1. Clone the repository
```bash
git clone https://github.com/Fizzy444/watch-together.git
cd watch-together
```

### 2. Install dependencies & Build
```bash
npm run build
```

---

### 🖥️ Run the Rust Desktop App (Tauri v2)

#### Live Development Mode (Hot Reload)
```bash
npm run tauri:dev
```
*Starts the Vite dev server and opens the native Rust desktop application with live reload.*

#### Run the Compiled Native Binary Directly
```powershell
.\src-tauri\target\debug\watch-together.exe
```

#### Run Automated Rust Tests
```bash
cd src-tauri
cargo test
```
*Verifies the RFC-compliant HTTP 206 range-request video server and subtitle matching engine.*

#### Build a Production Installer
```bash
npm run tauri:build
```

---

### 🌐 Run Web Services Separately (Development Mode)

```bash
# Terminal 1 — Backend (Port 3001)
cd server
npm run dev

# Terminal 2 — Frontend (Port 5173 with API/WS proxy)
cd client
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

#### Unified Web Server (Single Port)
```bash
npm start
```
Open [http://localhost:3001](http://localhost:3001). The Express server serves the React frontend, REST endpoints, and WebSockets on port 3001.

---

## ☁️ Deploy to Render.com (100% Free)

You can host Watch Together for free using a single **Web Service** on [Render](https://render.com).

1. Push your code to GitHub:
   ```bash
   git add .
   git commit -m "Deploy to Render"
   git push origin main
   ```
2. On [dashboard.render.com](https://dashboard.render.com), click **New +** $\rightarrow$ **Web Service**.
3. Select your repository and configure:
   - **Environment**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
   - **Health Check Path**: `/health`

---

## 📂 Project Structure

```
watch-together/
├── src-tauri/                   # Rust Desktop Application (Tauri v2)
│   ├── src/
│   │   ├── main.rs              # Desktop executable entry
│   │   ├── lib.rs               # Window lifecycle & command registrations
│   │   ├── video_server.rs      # Axum HTTP 206 range server & Cloudflare tunnel
│   │   ├── subtitles.rs         # FFmpeg subtitle probe & auto-detection
│   │   └── torrent.rs           # Torrent streaming lifecycle
│   ├── tests/                   # Integration tests (HTTP 206 & subtitles)
│   ├── Cargo.toml               # Rust dependencies
│   └── tauri.conf.json          # Tauri application settings & bundle config
├── client/                      # React Frontend (Vite)
│   ├── src/
│   │   ├── api/                 # REST API client
│   │   ├── components/          # VideoPlayer, CreateRoomModal, AuthModal, ChatBox...
│   │   ├── hooks/               # useWebRTC, useWebSocket, useRoom
│   │   ├── pages/               # Landing, Home (Dashboard), Room
│   │   └── utils/               # desktopBridge.js, auth, profile helpers
│   ├── package.json
│   └── vite.config.js
├── server/                      # Node.js Express & WebSocket Server
│   ├── src/
│   │   ├── routes/              # auth, rooms, movies
│   │   ├── services/            # roomManager, userManager
│   │   ├── ws/                  # WebSocket handler & WebRTC signaling
│   │   ├── config.js            # Ports, timeouts & storage paths
│   │   └── index.js             # HTTP/WS server entry & static asset serving
│   ├── data/                    # JSON user storage (auto-created)
│   └── package.json
├── package.json                 # Root build & Tauri run scripts
├── render.yaml                  # Render Blueprint definition
└── README.md
```

---

## 📄 License
MIT License. Free for personal and commercial use.
