# Architecture & Engineering Decisions

## Decision: Live FFmpeg Pipe (fMP4) vs Full Pre-Remux
- **Context**: MKV files with AC3/DTS audio could not play in browsers without remuxing/transcoding. Full pre-remux required copying and transcoding the entire 2-hour file to disk before playback could start, leading to excessive waiting times and disk usage.
- **Decision**: Implement live FFmpeg pipe outputting fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`) piped directly into the HTTP response.
- **Rationale**: Playback starts instantly (under 2 seconds) with zero temporary disk usage. Video is copied (`-c:v copy`) without re-encoding, and audio is transcoded to stereo AAC in real time. Seeking is supported via `-ss` on stream reconnects with frontend offset tracking.
