# Architecture & Engineering Decisions

## Decision: Live FFmpeg Pipe (fMP4) vs Full Pre-Remux
- **Context**: MKV files with AC3/DTS audio could not play in browsers without remuxing/transcoding. Full pre-remux required copying and transcoding the entire 2-hour file to disk before playback could start, leading to excessive waiting times and disk usage.
- **Decision**: Implement live FFmpeg pipe outputting fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`) piped directly into the HTTP response.
- **Rationale**: Playback starts instantly (under 2 seconds) with zero temporary disk usage. Video is copied (`-c:v copy`) without re-encoding, and audio is transcoded to stereo AAC in real time. Seeking is supported via `-ss` on stream reconnects with frontend offset tracking.

## Decision: Migrate Desktop App from Electron to Rust (Tauri v2)
- **Context**: The existing Electron desktop app required bundling Chromium and Node.js runtimes, resulting in large application distributions (~120MB+), high idle memory footprint (~300MB), and slower startup times.
- **Decision**: Migrate desktop app backend entirely to Rust using Tauri v2, serving the existing React 19 frontend in the system's native WebView, with native Rust commands for file selection, media probing, HTTP 206 range-request video serving, Cloudflare Quick Tunnel orchestration, and subtitle detection.
- **Rationale**: Reduces binary footprint down to ~10MB, drops memory usage to ~30-40MB, leverages Rust's memory safety and Tokio's asynchronous I/O for video streaming, and eliminates Node/Chromium desktop overhead while maintaining 100% API compatibility with the React frontend via `desktopBridge.js`.
