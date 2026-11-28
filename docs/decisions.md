# Architecture & Engineering Decisions

## Decision: Live FFmpeg Pipe (fMP4) vs Full Pre-Remux
- **Context**: MKV files with AC3/DTS audio could not play in browsers without remuxing/transcoding. Full pre-remux required copying and transcoding the entire 2-hour file to disk before playback could start, leading to excessive waiting times and disk usage.
- **Decision**: Implement live FFmpeg pipe outputting fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`) piped directly into the HTTP response.
- **Rationale**: Playback starts instantly (under 2 seconds) with zero temporary disk usage. Video is copied (`-c:v copy`) without re-encoding, and audio is transcoded to stereo AAC in real time. Seeking is supported via `-ss` on stream reconnects with frontend offset tracking.

## Decision: Migrate Desktop App from Electron to Rust (Tauri v2)
- **Context**: The existing Electron desktop app required bundling Chromium and Node.js runtimes, resulting in large application distributions (~120MB+), high idle memory footprint (~300MB), and slower startup times.
- **Decision**: Migrate desktop app backend entirely to Rust using Tauri v2, serving the existing React 19 frontend in the system's native WebView, with native Rust commands for file selection, media probing, HTTP 206 range-request video serving, Cloudflare Quick Tunnel orchestration, and subtitle detection.
- **Rationale**: Reduces binary footprint down to ~10MB, drops memory usage to ~30-40MB, leverages Rust's memory safety and Tokio's asynchronous I/O for video streaming, and eliminates Node/Chromium desktop overhead while maintaining 100% API compatibility with the React frontend via `desktopBridge.js`.

## Decision: Full-Mesh WebRTC Voice Chat with RNNoise AudioWorklet Pipeline
- **Context**: Browser `noiseSuppression: true` uses basic spectral subtraction that leaves keyboard clicks, fan noise, and room ambience audible and can clip speech, while P2P video WebRTC signaling (`webrtc_signal`) only flows host-to-viewers.
- **Decision**: Add dedicated full-mesh WebRTC voice signaling (`voice_join`, `voice_leave`, `voice_state`, `voice_signal`) with deterministic initiator ordering (`myUserId < peerId`) and a 48kHz Web Audio pipeline (`85Hz high-pass -> @sapphi-red/web-noise-suppressor RNNoise WASM AudioWorklet -> NoiseGateWorkletNode -> DynamicsCompressor -> Opus 48kHz FEC SDP`), plus per-peer `GainNode` playback (0–200%).
- **Rationale**: Keeps voice independent of video streaming mode (HLS/Tunnel/Torrent/P2P), delivers Discord-grade neural speech denoising with automatic fallback to browser noise suppression if AudioWorklet is unavailable, and avoids Chromium's silent `MediaStreamAudioSourceNode` WebRTC bug via a muted anchor `<audio>` element.
