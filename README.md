# Watch Together 🎬⚡

A private, frame-accurate, synchronized movie watching platform featuring **WebRTC Multi-User P2P Live Broadcasting** and **HTTP 206 progressive server streaming**.

Watch videos together with friends across cities, Wi-Fi, and cellular mobile data without buffering desync or complex setups.

---

## ✨ Features

- ⚡ **WebRTC P2P Multi-User Broadcasting (0 Server Upload)**:
  - Stream any local video file (`.mp4`, `.mkv`, `.webm`, `.mov`) directly from your computer or phone to multiple friends in real time.
  - Video data travels directly peer-to-peer (1-to-many star mesh) without touching or storing files on the server.
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
   [ Host Device (Laptop) ]                 [ Viewer 1 (Friend) ]
   - Plays local file (blob:)               - Plays MediaStream live
   - Captures via captureStream()           - Zero server video traffic
             │
             │ WebRTC SRTP/UDP (Encrypted P2P)
             ▼
   [ Viewer 2 (Friend) ]
   - Plays MediaStream live
```

- **Frontend**: React 19, Vite, Lucide Icons, Vanilla CSS (High-contrast dark mode).
- **Backend**: Node.js, Express, WebSocket (`ws`), Node Native Crypto (scrypt password hashing).
- **Video Traversal**: WebRTC (`RTCPeerConnection`), Google STUN, OpenRelay TURN.

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- Node.js 18+
- npm 9+

### 1. Clone the repository
```bash
git clone https://github.com/your-username/watch-together.git
cd watch-together
```

### 2. Install dependencies & Build
From the root directory:
```bash
npm run build
```

### 3. Run Locally

#### Option A: Run Both Services Separately (Development Mode)
```bash
# Terminal 1 — Backend (Port 3001)
cd server
npm run dev

# Terminal 2 — Frontend (Port 5173 with API/WS proxy)
cd client
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

#### Option B: Unified Production Server (Single Port)
```bash
npm start
```
Open [http://localhost:3001](http://localhost:3001). The Express server will serve the React frontend, REST endpoints, and WebSockets all on port 3001.

---

## ☁️ Deploy to Render.com (100% Free)

You can host Watch Together for free using a single **Web Service** on [Render](https://render.com).

### 1. Push your code to GitHub
```bash
git add .
git commit -m "Deploy to Render"
git push origin main
```

### 2. Create Web Service on Render
1. Go to [dashboard.render.com](https://dashboard.render.com) and click **New +** $\rightarrow$ **Web Service**.
2. Connect your GitHub repository.
3. Configure the settings:
   - **Name**: `watch-together` (or custom name)
   - **Environment**: `Node`
   - **Region**: Closest to your location (e.g. *Singapore*, *Frankfurt*, *Oregon*)
   - **Branch**: `main`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: **Free**
   - **Health Check Path**: `/health` (under Advanced)
4. Click **Deploy Web Service**.

Render will deploy the unified server and provide a free HTTPS URL:
`https://your-app-name.onrender.com`

---

## 📂 Project Structure

```
watch-together/
├── client/                      # React Frontend (Vite)
│   ├── src/
│   │   ├── api/                 # REST API client
│   │   ├── components/          # VideoPlayer, CreateRoomModal, AuthModal, ChatBox...
│   │   ├── hooks/               # useWebRTC, useWebSocket, useRoom
│   │   ├── pages/               # Landing, Home (Dashboard), Room
│   │   └── utils/               # Auth, profile, library helpers
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
├── package.json                 # Root build & start scripts for Render/production
├── render.yaml                  # Render Blueprint definition
└── README.md
```

---

## 📄 License
MIT License. Free for personal and commercial use.
