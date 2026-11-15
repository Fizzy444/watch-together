# Project Plan: Migrate Desktop App from Electron to Rust (Tauri v2)

## Goal
Replace the Electron desktop runtime with a lightweight, secure, and high-performance Rust Tauri v2 desktop application. The finished app delivers all existing desktop capabilities (native video file selection, automated Cloudflare Quick Tunnel streaming, ffprobe/ffmpeg audio transcode and remuxing, subtitle auto-detection/extraction, and torrent handling) with significantly reduced memory and binary size.

## Users and Scenario
Desktop users wanting to watch synchronized movies with friends. A user creates a room by selecting a local video file (MP4, MKV, WebM, MOV) or a torrent magnet link; the Rust desktop backend sets up a local HTTP range-streaming server, opens an automated Cloudflare Tunnel for viewers, extracts/selects subtitles, and coordinates frame-accurate playback.

## Scope
### Included:
- Tauri v2 Rust desktop application (`src-tauri`) with native system WebView.
- Rust IPC commands replicating Electron's IPC:
  - `select_video_file`: Native file dialog for video media.
  - `select_subtitle_file`: Native file dialog for subtitles.
  - `find_matching_subtitles`: Container subtitle probe and extraction via `ffprobe`/`ffmpeg` + local directory matching `.srt`/`.vtt` detection.
  - `start_host_tunnel`: Local HTTP 206 partial content streaming server with `cloudflared` Quick Tunnel orchestration and progress events.
  - `stop_host_tunnel`: Clean teardown of streaming server, ffmpeg remux processes, and cloudflared tunnels.
  - `start_torrent` / `stop_torrent`: Torrent streaming lifecycle and progress updates.
- Frontend bridge (`client/src/utils/desktopBridge.js` exposing `window.desktopAPI` and `window.electronAPI`) so existing React components function seamlessly without regressions.
- Updating `package.json` scripts (`tauri:dev`, `tauri:build`) and removing Electron dependencies.
- Retaining full browser client compatibility for web users.

### Explicitly Not Included:
- Rewriting the Node.js signaling/room server (`server/`) into Rust (the request specifically targets the desktop app codebase from Electron to Rust).
- Rewriting the React UI components from scratch (React 19 + Vite frontend is preserved and bundled by Tauri).

## Stack
- **Rust (1.99+)**: Core desktop application runtime, fast, memory-safe, tiny binary footprint.
- **Tauri v2**: Desktop application framework binding Rust backend with native webview.
- **Tokio & Axum / Hyper**: Async runtime and high-performance HTTP 206 range-request video server.
- **FFmpeg & FFprobe**: Media probing, fast audio transcoding (stereo AAC), and embedded subtitle extraction.
- **Cloudflared**: Automated Quick Tunnel for zero-config public streaming to remote viewers.
- **React 19 & Vite**: Existing frontend UI.

## Data
- Temporary remux cache: OS cache / app local data directory for faststart MP4 transmuxing.
- Active streaming sessions: Stored in Rust in-memory application state (`tauri::State`).

## Interfaces
- **Tauri Commands**:
  - `select_video_file` -> `Result<Option<VideoFileInfo>, String>`
  - `select_subtitle_file` -> `Result<Option<SubtitleFileInfo>, String>`
  - `find_matching_subtitles(video_path: Option<String>)` -> `Result<Vec<SubtitleTrack>, String>`
  - `start_host_tunnel(file_path: String)` -> `Result<TunnelResult, String>`
  - `stop_host_tunnel` -> `Result<bool, String>`
  - `start_torrent(magnet: String)` -> `Result<TorrentStreamResult, String>`
  - `stop_torrent` -> `Result<bool, String>`
- **Tauri Events**:
  - `host-tunnel-status`: `{ step, message, progress?, streamUrl? }`
  - `torrent-progress`: `{ progress, downloadSpeed, numPeers, hasMetadata }`
  - `torrent-error`: `string`

## Risks
1. **HTTP 206 Range Request Compliance**: Video streaming in HTML5 / WebView2 requires accurate HTTP byte range responses, `Accept-Ranges: bytes`, and `Content-Range`.
   - *Mitigation*: Use Axum with `tower_http::services::ServeFile` or robust byte-range streaming logic verified with tests.
2. **Cloudflared Process Lifecycle**: Dangling cloudflared or ffmpeg child processes on app close or error.
   - *Mitigation*: Rust process tracking with `Child::kill` on window close and command cancellation drops.
3. **Frontend Interop**: Discrepancies between Electron IPC responses and Tauri invoke results.
   - *Mitigation*: Create a robust compatibility adapter mapping Tauri events/invokes to the exact contract expected by React components.

## Milestones
- **Milestone 1**: Initialize Tauri v2 in `src-tauri` with Cargo dependencies, basic window configuration, and verify `cargo check` and Vite integration.
- **Milestone 2**: Implement native file pickers and subtitle probing/extraction (`select_video_file`, `select_subtitle_file`, `find_matching_subtitles`) in Rust.
- **Milestone 3**: Implement Rust local HTTP 206 streaming server and `cloudflared` Quick Tunnel lifecycle with status events (`start_host_tunnel`, `stop_host_tunnel`).
- **Milestone 4**: Implement torrent streaming handler and frontend bridge (`desktopBridge.js`), wire npm scripts (`tauri:dev`, `tauri:build`), and remove obsolete Electron configuration.
- **Milestone 5**: Full end-to-end verification, self-review, and document architectural choices in `docs/decisions.md`.
