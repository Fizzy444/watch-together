# Watch Together 🎬

A private-link, server-streamed, synchronized movie watching app.

## Quick Start

### 1. Start the backend
```bash
cd server
npm install
npm run dev
```
Server runs on http://localhost:3001

### 2. Start the frontend
```bash
cd client
npm install
npm run dev
```
App runs on http://localhost:5173

### 3. Watch together
1. Upload a movie via the browser UI
2. Click "Create Room" — share the link with friends
3. Everyone connects — the host controls playback

## Requirements
- Node.js 18+
- FFmpeg (`sudo apt install ffmpeg`)

## Architecture
- **Frontend**: React + Vite + hls.js
- **Backend**: Node.js + Express + ws
- **Video**: FFmpeg → HLS streaming
- **Sync**: WebSocket (play/pause/seek + 5s drift correction)
