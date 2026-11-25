use axum::body::Body;
use axum::extract::Request;
use axum::http::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, HeaderName,
    HeaderValue,
};
use axum::http::Response;
use axum::middleware::Next;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackInfo {
    pub id: u32,
    pub stream_index: u32,
    pub codec_name: String,
    pub language: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrackInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_index: Option<u32>,
    pub language: String,
    pub label: String,
    pub url: String,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoFileInfo {
    pub file_path: String,
    pub name: String,
    pub file_name: String,
    pub size: u64,
    pub file_size: u64,
    pub duration: f64,
    pub recommended_mode: String,
    pub reason: String,
    pub needs_transcode: bool,
    pub needs_faststart: bool,
    pub audio_tracks: Vec<AudioTrackInfo>,
    pub subtitle_tracks: Vec<SubtitleTrackInfo>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TunnelResult {
    pub stream_url: String,
    pub local_stream_url: String,
    pub tunnel_url: String,
    pub file_name: String,
    pub file_size: u64,
    pub duration: f64,
    pub is_hls: bool,
    pub stream_mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle_url: Option<String>,
    pub subtitle_tracks: Vec<SubtitleTrackInfo>,
    pub audio_tracks: Vec<AudioTrackInfo>,
}

#[derive(Default)]
pub struct ActiveTunnelState {
    pub server_shutdown: Option<oneshot::Sender<()>>,
    pub cloudflared_child: Option<tokio::process::Child>,
    pub ffmpeg_child: Option<tokio::process::Child>,
    pub current_video_path: Option<String>,
    pub current_temp_remux: Option<PathBuf>,
    pub hls_dir: Option<PathBuf>,
    pub stream_mode: Option<String>,
    pub needs_video_transcode: bool,
}

pub type SharedTunnelState = Arc<Mutex<ActiveTunnelState>>;

#[derive(Deserialize, Debug)]
struct FfprobeFormat {
    duration: Option<String>,
}

#[derive(Deserialize, Debug)]
struct FfprobeStream {
    index: Option<u32>,
    codec_type: Option<String>,
    codec_name: Option<String>,
    tags: Option<serde_json::Value>,
    disposition: Option<serde_json::Value>,
}

#[derive(Deserialize, Debug)]
struct FfprobeOutput {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
}

struct ProbeResult {
    duration: f64,
    needs_video_transcode: bool,
    needs_audio_transcode: bool,
    audio_tracks: Vec<AudioTrackInfo>,
    subtitle_streams: Vec<SubtitleTrackInfo>,
}

async fn probe_video_file(file_path: &str) -> ProbeResult {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=index,codec_type,codec_name:stream_tags=language,title:stream_disposition=default",
            "-of",
            "json",
            file_path,
        ])
        .output()
        .await;

    let probe_stdout = match output {
        Ok(out) if out.status.success() => out.stdout,
        _ => {
            return ProbeResult {
                duration: 0.0,
                needs_video_transcode: false,
                needs_audio_transcode: false,
                audio_tracks: Vec::new(),
                subtitle_streams: Vec::new(),
            };
        }
    };

    let parsed: FfprobeOutput = match serde_json::from_slice(&probe_stdout) {
        Ok(p) => p,
        Err(_) => {
            return ProbeResult {
                duration: 0.0,
                needs_video_transcode: false,
                needs_audio_transcode: false,
                audio_tracks: Vec::new(),
                subtitle_streams: Vec::new(),
            };
        }
    };

    let duration = parsed
        .format
        .and_then(|f| f.duration)
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);

    let streams = parsed.streams.unwrap_or_default();
    let video_streams: Vec<_> = streams
        .iter()
        .filter(|s| s.codec_type.as_deref() == Some("video"))
        .collect();

    let supported_video: HashSet<&str> = ["h264", "avc1"].into_iter().collect();

    let supported_audio: HashSet<&str> = ["aac", "mp3", "opus", "vorbis", "flac"]
        .into_iter()
        .collect();

    let needs_video_transcode = video_streams.first().map_or(false, |s| {
        let codec = s.codec_name.as_deref().unwrap_or("").to_lowercase();
        !supported_video.contains(codec.as_str())
    });

    let mut audio_tracks = Vec::new();
    let mut audio_counter = 0;

    for s in streams.iter().filter(|s| s.codec_type.as_deref() == Some("audio")) {
        let stream_index = s.index.unwrap_or(audio_counter);
        let codec = s.codec_name.as_deref().unwrap_or("unknown").to_lowercase();
        let lang = s
            .tags
            .as_ref()
            .and_then(|t| t.get("language").or_else(|| t.get("LANGUAGE")))
            .and_then(|v| v.as_str())
            .unwrap_or("und")
            .to_string();

        let title = s
            .tags
            .as_ref()
            .and_then(|t| t.get("title").or_else(|| t.get("TITLE")))
            .and_then(|v| v.as_str())
            .map(|st| st.to_string());

        let is_default = s
            .disposition
            .as_ref()
            .and_then(|d| d.get("default"))
            .and_then(|v| v.as_i64())
            .map(|v| v == 1)
            .unwrap_or(audio_counter == 0);

        let label = if let Some(ref t) = title {
            if lang != "und" {
                format!("{t} ({})", lang.to_uppercase())
            } else {
                t.clone()
            }
        } else if lang != "und" {
            format!("Audio Track {} ({})", audio_counter + 1, lang.to_uppercase())
        } else {
            format!("Audio Track {}", audio_counter + 1)
        };

        audio_tracks.push(AudioTrackInfo {
            id: audio_counter,
            stream_index,
            codec_name: codec,
            language: lang,
            label,
            title,
            is_default,
        });

        audio_counter += 1;
    }

    let mut subtitle_streams = Vec::new();
    let mut sub_counter = 0;

    for s in streams.iter().filter(|s| s.codec_type.as_deref() == Some("subtitle")) {
        let stream_index = s.index.unwrap_or(sub_counter);
        let lang = s
            .tags
            .as_ref()
            .and_then(|t| t.get("language").or_else(|| t.get("LANGUAGE")))
            .and_then(|v| v.as_str())
            .unwrap_or("und")
            .to_string();

        let title = s
            .tags
            .as_ref()
            .and_then(|t| t.get("title").or_else(|| t.get("TITLE")))
            .and_then(|v| v.as_str())
            .map(|st| st.to_string());

        let is_default = s
            .disposition
            .as_ref()
            .and_then(|d| d.get("default"))
            .and_then(|v| v.as_i64())
            .map(|v| v == 1)
            .unwrap_or(sub_counter == 0);

        let label = if let Some(ref t) = title {
            if lang != "und" {
                format!("{t} ({})", lang.to_uppercase())
            } else {
                t.clone()
            }
        } else if lang != "und" {
            format!("Subtitle {} ({})", sub_counter + 1, lang.to_uppercase())
        } else {
            format!("Subtitle {}", sub_counter + 1)
        };

        subtitle_streams.push(SubtitleTrackInfo {
            id: format!("sub-{sub_counter}"),
            stream_index: Some(stream_index),
            language: lang,
            label,
            url: String::new(),
            is_default,
        });

        sub_counter += 1;
    }

    let needs_audio_transcode = audio_tracks.iter().any(|t| {
        !supported_audio.contains(t.codec_name.as_str())
    });

    ProbeResult {
        duration,
        needs_video_transcode,
        needs_audio_transcode,
        audio_tracks,
        subtitle_streams,
    }
}

fn resolve_cloudflared_binary() -> PathBuf {
    let mut candidates = vec![
        PathBuf::from("client/node_modules/cloudflared/bin/cloudflared.exe"),
        PathBuf::from("../client/node_modules/cloudflared/bin/cloudflared.exe"),
        PathBuf::from("client/node_modules/cloudflared/bin/cloudflared"),
        PathBuf::from("../client/node_modules/cloudflared/bin/cloudflared"),
    ];

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            candidates.push(parent.join(if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" }));
            candidates.push(parent.join("bin").join(if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" }));
        }
    }

    for path in candidates {
        if path.exists() {
            if let Ok(abs) = path.canonicalize() {
                return abs;
            }
            return path;
        }
    }

    PathBuf::from(if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" })
}

async fn allow_private_network(request: Request<Body>, next: Next) -> Response<Body> {
    let uri_path = request.uri().path().to_lowercase();
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(
        HeaderName::from_static("access-control-allow-private-network"),
        HeaderValue::from_static("true"),
    );
    headers.insert(
        HeaderName::from_static("access-control-allow-origin"),
        HeaderValue::from_static("*"),
    );

    if uri_path.ends_with(".ts") || uri_path.ends_with(".m4s") {
        headers.insert(
            CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    } else if uri_path.ends_with(".m3u8") {
        headers.insert(
            CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        );
    } else if uri_path.ends_with(".vtt") {
        headers.insert(
            CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400"),
        );
    }

    response
}

#[tauri::command]
pub async fn select_video_file() -> Result<Option<VideoFileInfo>, String> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Select Video File to Stream")
        .add_filter("Video Files", &["mp4", "mkv", "webm", "mov", "avi"])
        .pick_file()
        .await;

    let file = match handle {
        Some(f) => f,
        None => return Ok(None),
    };

    let path = file.path().to_path_buf();
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("video.mp4")
        .to_string();

    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let size = meta.len();

    let probe = probe_video_file(&path.to_string_lossy()).await;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let needs_faststart = ext == "mp4" && crate::mp4::needs_faststart(&path);
    let needs_transcode = probe.needs_video_transcode || probe.needs_audio_transcode;

    let (recommended_mode, reason) = if ext != "mp4" && ext != "webm" {
        ("hls".to_string(), format!("Container (.{ext}) requires HLS engine for browser playback"))
    } else if probe.needs_video_transcode {
        ("hls".to_string(), "Video codec requires transcoding to H.264".to_string())
    } else if probe.needs_audio_transcode {
        ("hls".to_string(), "Audio track requires transcoding to AAC".to_string())
    } else if probe.audio_tracks.len() > 1 {
        (
            "hls".to_string(),
            format!(
                "Multiple audio tracks detected ({} tracks) — HLS engine enabled for audio language switching",
                probe.audio_tracks.len()
            ),
        )
    } else if probe.subtitle_streams.len() > 1 {
        (
            "hls".to_string(),
            format!(
                "Multiple subtitle tracks detected ({} tracks) — HLS engine enabled for multi-language subtitles",
                probe.subtitle_streams.len()
            ),
        )
    } else if needs_faststart {
        ("hls".to_string(), "MP4 metadata is at end of file (HLS recommended for instant start)".to_string())
    } else {
        ("direct".to_string(), "Optimized for Direct Passthrough (instant 0s start • 0% CPU)".to_string())
    };

    Ok(Some(VideoFileInfo {
        file_path: path.to_string_lossy().to_string(),
        name: file_name.clone(),
        file_name,
        size,
        file_size: size,
        duration: probe.duration,
        recommended_mode,
        reason,
        needs_transcode,
        needs_faststart,
        audio_tracks: probe.audio_tracks,
        subtitle_tracks: probe.subtitle_streams,
    }))
}

pub async fn cleanup_tunnel(state: &SharedTunnelState) {
    let mut guard = state.lock().await;

    if let Some(mut child) = guard.ffmpeg_child.take() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    if let Some(temp_path) = guard.current_temp_remux.take() {
        let _ = fs::remove_file(temp_path);
    }

    if let Some(hls_dir) = guard.hls_dir.take() {
        let _ = fs::remove_dir_all(hls_dir);
    }

    if let Some(mut child) = guard.cloudflared_child.take() {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    if let Some(shutdown) = guard.server_shutdown.take() {
        let _ = shutdown.send(());
    }

    guard.current_video_path = None;
    guard.stream_mode = None;
    guard.needs_video_transcode = false;
}

#[tauri::command]
pub async fn stop_host_tunnel(
    state: tauri::State<'_, SharedTunnelState>,
) -> Result<bool, String> {
    cleanup_tunnel(&state).await;
    Ok(true)
}

fn spawn_hls_ffmpeg(
    video_path: &str,
    hls_dir: &Path,
    start_seconds: f64,
    needs_video_transcode: bool,
    audio_tracks: &[AudioTrackInfo],
) -> Result<tokio::process::Child, String> {
    let mut args = vec![
        "-y".to_string(),
        "-fflags".to_string(),
        "+genpts".to_string(),
        "-ss".to_string(),
        format!("{:.3}", start_seconds),
        "-i".to_string(),
        video_path.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
    ];

    if audio_tracks.len() > 1 {
        for track in audio_tracks {
            args.push("-map".to_string());
            args.push(format!("0:{}", track.stream_index));
        }
    } else {
        args.push("-map".to_string());
        args.push("0:a:0?".to_string());
    }

    if needs_video_transcode {
        args.extend([
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            "ultrafast".to_string(),
            "-crf".to_string(),
            "22".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    } else {
        args.extend(["-c:v".to_string(), "copy".to_string()]);
    }

    args.extend([
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-ac".to_string(),
        "2".to_string(),
        "-avoid_negative_ts".to_string(),
        "make_zero".to_string(),
        "-f".to_string(),
        "hls".to_string(),
        "-hls_time".to_string(),
        "4".to_string(),
        "-hls_list_size".to_string(),
        "0".to_string(),
        "-hls_flags".to_string(),
        "independent_segments".to_string(),
        "-hls_segment_type".to_string(),
        "mpegts".to_string(),
        "-start_number".to_string(),
        "0".to_string(),
    ]);

    if audio_tracks.len() > 1 {
        let mut var_stream_parts = vec!["v:0,agroup:audio".to_string()];
        for (idx, track) in audio_tracks.iter().enumerate() {
            let lang = if track.language == "und" { "und" } else { &track.language };
            let default_str = if track.is_default || (idx == 0 && !audio_tracks.iter().any(|t| t.is_default)) {
                "yes"
            } else {
                "no"
            };
            let clean_name = track.label.replace(|c: char| !c.is_alphanumeric() && c != '_', "_");
            var_stream_parts.push(format!(
                "a:{},agroup:audio,language:{},name:{},default:{}",
                idx, lang, clean_name, default_str
            ));
        }

        let var_stream_map = var_stream_parts.join(" ");
        args.extend([
            "-master_pl_name".to_string(),
            "stream.m3u8".to_string(),
            "-var_stream_map".to_string(),
            var_stream_map,
            "-hls_segment_filename".to_string(),
            hls_dir.join("seg_%v_%03d.ts").to_string_lossy().to_string(),
            hls_dir.join("variant_%v.m3u8").to_string_lossy().to_string(),
        ]);
    } else {
        let playlist_path = hls_dir.join("stream.m3u8");
        let segment_pattern = hls_dir.join("seg_%03d.ts").to_string_lossy().to_string();
        args.extend([
            "-hls_segment_filename".to_string(),
            segment_pattern,
            playlist_path.to_string_lossy().to_string(),
        ]);
    }

    let mut cmd = Command::new("ffmpeg");
    cmd.args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg for HLS: {e}"))
}

#[tauri::command]
pub async fn seek_hls_stream(
    _state: tauri::State<'_, SharedTunnelState>,
    _target_seconds: f64,
) -> Result<bool, String> {
    // Hls.js client handles seeking across the generated segments smoothly.
    // Deleting active segments from disk causes fatal 404s and freezes playback.
    Ok(true)
}

#[tauri::command]
pub async fn start_host_tunnel(
    app: AppHandle,
    state: tauri::State<'_, SharedTunnelState>,
    file_path: String,
    stream_mode: Option<String>,
) -> Result<TunnelResult, String> {
    cleanup_tunnel(&state).await;

    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("Selected video file does not exist: {file_path}"));
    }

    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    let file_size = metadata.len();
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("video.mp4")
        .to_string();
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let _ = app.emit(
        "host-tunnel-status",
        serde_json::json!({
            "step": "analyzing-media",
            "message": "Analyzing video and audio tracks..."
        }),
    );

    let probe = probe_video_file(&file_path).await;
    let duration = probe.duration;
    let needs_transcode = probe.needs_video_transcode || probe.needs_audio_transcode;
    let needs_faststart = ext == "mp4" && crate::mp4::needs_faststart(&path);

    let selected_mode = match stream_mode.as_deref() {
        Some("hls") => "hls".to_string(),
        Some("direct") => {
            if probe.audio_tracks.len() > 1 {
                let _ = app.emit(
                    "host-tunnel-status",
                    serde_json::json!({
                        "step": "fallback-hls",
                        "message": "Multiple audio tracks detected — using HLS engine for audio language switching."
                    }),
                );
                "hls".to_string()
            } else if ext == "mp4" || ext == "webm" {
                if !probe.needs_video_transcode && !probe.needs_audio_transcode {
                    "direct".to_string()
                } else if !probe.needs_video_transcode {
                    let _ = app.emit(
                        "host-tunnel-status",
                        serde_json::json!({
                            "step": "fallback-hls",
                            "message": "Audio track requires transcoding to AAC — switched to HLS."
                        }),
                    );
                    "hls".to_string()
                } else {
                    let _ = app.emit(
                        "host-tunnel-status",
                        serde_json::json!({
                            "step": "fallback-hls",
                            "message": "Video codec requires transcoding to H.264 — switched to HLS."
                        }),
                    );
                    "hls".to_string()
                }
            } else {
                let _ = app.emit(
                    "host-tunnel-status",
                    serde_json::json!({
                        "step": "fallback-hls",
                        "message": format!("Container '.{ext}' cannot be played directly by browsers — using HLS.")
                    }),
                );
                "hls".to_string()
            }
        }
        _ => {
            if ext == "mkv"
                || ext == "avi"
                || ext == "mov"
                || needs_transcode
                || needs_faststart
                || probe.audio_tracks.len() > 1
                || probe.subtitle_streams.len() > 1
            {
                "hls".to_string()
            } else {
                "direct".to_string()
            }
        }
    };

    let mut is_hls = false;
    let mut active_hls_dir: Option<PathBuf> = None;

    if selected_mode == "hls" {
        is_hls = true;
        let _ = app.emit(
            "host-tunnel-status",
            serde_json::json!({
                "step": "starting-hls",
                "message": "Initializing Just-In-Time HLS engine (4s chunks)..."
            }),
        );

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let hls_dir = std::env::temp_dir().join(format!("wt-hls-{timestamp}"));
        let _ = fs::create_dir_all(&hls_dir);

        for (idx, sub) in probe.subtitle_streams.iter().enumerate() {
            if let Some(stream_index) = sub.stream_index {
                let filename = format!("subtitles_{}_{}.vtt", idx, sub.language);
                let vtt_out = hls_dir.join(&filename);
                let _ = Command::new("ffmpeg")
                    .args([
                        "-v", "error",
                        "-y",
                        "-i", &file_path,
                        "-map", &format!("0:{stream_index}"),
                        "-f", "webvtt",
                        &vtt_out.to_string_lossy(),
                    ])
                    .output()
                    .await;
            }
        }

        let vtt_path = hls_dir.join("subtitles.vtt");
        let first_extracted = probe.subtitle_streams.first().map(|sub| {
            hls_dir.join(format!("subtitles_0_{}.vtt", sub.language))
        });

        if let Some(first_path) = first_extracted.filter(|p| p.exists()) {
            let _ = fs::copy(first_path, &vtt_path);
        } else if probe.subtitle_streams.is_empty() {
            let _ = Command::new("ffmpeg")
                .args([
                    "-v", "error",
                    "-y",
                    "-i", &file_path,
                    "-map", "0:s:0?",
                    "-f", "webvtt",
                    &vtt_path.to_string_lossy(),
                ])
                .output()
                .await;
        }

        let child = match spawn_hls_ffmpeg(
            &file_path,
            &hls_dir,
            0.0,
            probe.needs_video_transcode,
            &probe.audio_tracks,
        ) {
            Ok(child) => child,
            Err(error) => {
                let _ = fs::remove_dir_all(&hls_dir);
                return Err(error);
            }
        };

        {
            let mut guard = state.lock().await;
            guard.ffmpeg_child = Some(child);
            guard.hls_dir = Some(hls_dir.clone());
            guard.current_video_path = Some(file_path.clone());
            guard.stream_mode = Some("hls".to_string());
            guard.needs_video_transcode = probe.needs_video_transcode;
        }

        let playlist_path = hls_dir.join("stream.m3u8");
        let mut playlist_ready = false;
        for _ in 0..50 {
            if playlist_path.exists() {
                playlist_ready = true;
                break;
            }
            {
                let mut guard = state.lock().await;
                if let Some(child) = guard.ffmpeg_child.as_mut() {
                    if let Ok(Some(status)) = child.try_wait() {
                        drop(guard);
                        cleanup_tunnel(&state).await;
                        return Err(format!("FFmpeg failed to initialize HLS stream (exit code: {status})"));
                    }
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        if !playlist_ready {
            cleanup_tunnel(&state).await;
            return Err("Timed out waiting for HLS playlist generation".to_string());
        }

        active_hls_dir = Some(hls_dir);
    } else {
        let mut guard = state.lock().await;
        guard.current_video_path = Some(file_path.clone());
        guard.stream_mode = Some(selected_mode.clone());
    }

    let _ = app.emit(
        "host-tunnel-status",
        serde_json::json!({
            "step": "starting-server",
            "message": "Starting local video streaming server..."
        }),
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local port: {e}"))?;
    let local_port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let video_service = ServeFile::new(path.clone());

    let mut router = axum::Router::new()
        .route(
            "/health",
            axum::routing::get({
                let probe_duration = duration;
                move || async move {
                    axum::Json(serde_json::json!({ "status": "ok", "duration": probe_duration }))
                }
            }),
        )
        .route(
            "/info",
            axum::routing::get({
                let f_name = file_name.clone();
                let m_name = selected_mode.clone();
                move || async move {
                    axum::Json(serde_json::json!({
                        "status": "ok",
                        "file": f_name,
                        "size": file_size,
                        "duration": duration,
                        "mode": m_name,
                    }))
                }
            }),
        )
        .route_service("/video", video_service.clone())
        .route_service("/video/", video_service);

    if let Some(ref h_dir) = active_hls_dir {
        router = router.nest_service("/hls", ServeDir::new(h_dir));
    }

    let cors = CorsLayer::permissive()
        .allow_origin(tower_http::cors::Any)
        .allow_methods(tower_http::cors::Any)
        .allow_headers(tower_http::cors::Any)
        .expose_headers([CONTENT_RANGE, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_TYPE, CACHE_CONTROL]);

    let server_app = router
        .layer(cors)
        .layer(axum::middleware::from_fn(allow_private_network));

    tokio::spawn(async move {
        let _ = axum::serve(listener, server_app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

    {
        let mut guard = state.lock().await;
        guard.server_shutdown = Some(shutdown_tx);
    }

    let _ = app.emit(
        "host-tunnel-status",
        serde_json::json!({
            "step": "creating-tunnel",
            "message": "Connecting Cloudflare Quick Tunnel..."
        }),
    );

    let cloudflared_bin = resolve_cloudflared_binary();
    let mut cf_cmd = Command::new(&cloudflared_bin);
    cf_cmd
        .args([
            "tunnel",
            "--url",
            &format!("http://127.0.0.1:{local_port}"),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let mut cf_child = match cf_cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            cleanup_tunnel(&state).await;
            return Err(format!("Failed to launch cloudflared: {error}"));
        }
    };

    let stderr = match cf_child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = cf_child.kill().await;
            let _ = cf_child.wait().await;
            cleanup_tunnel(&state).await;
            return Err("Failed to read cloudflared stderr".to_string());
        }
    };

    let (url_tx, url_rx) = oneshot::channel::<String>();
    let url_tx_opt = Arc::new(Mutex::new(Some(url_tx)));

    let app_tunnel = app.clone();
    let tx_ref = url_tx_opt.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let url_re = Regex::new(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com").unwrap();
        let mut last_startup_error: Option<String> = None;

        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(m) = url_re.find(&line) {
                let url = m.as_str().to_string();
                let mut lock = tx_ref.lock().await;
                if let Some(tx) = lock.take() {
                    let _ = tx.send(url);
                }
                continue;
            }

            let is_benign_notice = line.contains("Failed to initialize DNS local resolver")
                || line.contains("Cannot determine default origin certificate")
                || line.contains("use of closed network connection")
                || line.contains("context canceled");

            if !is_benign_notice && (line.contains(" ERR ") || line.contains("error=")) {
                last_startup_error = Some(line);
            }
        }

        if tx_ref.lock().await.is_some() {
            let message = last_startup_error
                .unwrap_or_else(|| "Cloudflare tunnel exited before publishing a URL.".to_string());
            let _ = app_tunnel.emit(
                "host-tunnel-status",
                serde_json::json!({
                    "step": "error",
                    "message": message
                }),
            );
        }
    });

    let tunnel_base_url =
        match tokio::time::timeout(std::time::Duration::from_secs(30), url_rx).await {
            Ok(Ok(url)) => url,
            Ok(Err(_)) => {
                let _ = cf_child.kill().await;
                let _ = cf_child.wait().await;
                cleanup_tunnel(&state).await;
                return Err("Failed to obtain Cloudflare tunnel URL".to_string());
            }
            Err(_) => {
                let _ = cf_child.kill().await;
                let _ = cf_child.wait().await;
                cleanup_tunnel(&state).await;
                return Err("Timeout waiting for Cloudflare tunnel URL".to_string());
            }
        };

    let mut subtitle_tracks: Vec<SubtitleTrackInfo> = Vec::new();
    let (stream_url, local_stream_url) = if is_hls {
        let s_url = format!("{tunnel_base_url}/hls/stream.m3u8");
        let l_url = format!("http://127.0.0.1:{local_port}/hls/stream.m3u8");
        if let Some(ref h_dir) = active_hls_dir {
            for (idx, sub) in probe.subtitle_streams.iter().enumerate() {
                let filename = format!("subtitles_{}_{}.vtt", idx, sub.language);
                let vtt = h_dir.join(&filename);
                if vtt.exists() && fs::metadata(&vtt).map(|m| m.len() > 10).unwrap_or(false) {
                    subtitle_tracks.push(SubtitleTrackInfo {
                        id: format!("sub-{idx}"),
                        stream_index: sub.stream_index,
                        language: sub.language.clone(),
                        label: sub.label.clone(),
                        url: format!("{tunnel_base_url}/hls/{filename}"),
                        is_default: sub.is_default,
                    });
                }
            }

            let fallback_vtt = h_dir.join("subtitles.vtt");
            if subtitle_tracks.is_empty()
                && fallback_vtt.exists()
                && fs::metadata(&fallback_vtt).map(|m| m.len() > 10).unwrap_or(false)
            {
                subtitle_tracks.push(SubtitleTrackInfo {
                    id: "sub-default".to_string(),
                    stream_index: Some(0),
                    language: "und".to_string(),
                    label: "Default Subtitles".to_string(),
                    url: format!("{tunnel_base_url}/hls/subtitles.vtt"),
                    is_default: true,
                });
            }

            let ext_tracks = crate::subtitles::scan_directory_subtitles(&path);
            for (ext_idx, ext_sub) in ext_tracks.into_iter().enumerate() {
                let ext_filename = format!("external_sub_{ext_idx}.vtt");
                let target_path = h_dir.join(&ext_filename);
                if fs::write(&target_path, &ext_sub.content).is_ok() {
                    subtitle_tracks.push(SubtitleTrackInfo {
                        id: format!("sub-ext-{ext_idx}"),
                        stream_index: None,
                        language: ext_sub.language.unwrap_or_else(|| "und".to_string()),
                        label: ext_sub.file_name,
                        url: format!("{tunnel_base_url}/hls/{ext_filename}"),
                        is_default: false,
                    });
                }
            }

            if let Ok(json_bytes) = serde_json::to_vec(&subtitle_tracks) {
                let _ = fs::write(h_dir.join("subtitles.json"), json_bytes);
            }
        }
        (s_url, l_url)
    } else {
        (
            format!("{tunnel_base_url}/video"),
            format!("http://127.0.0.1:{local_port}/video"),
        )
    };

    let subtitle_url = subtitle_tracks.first().map(|s| s.url.clone());

    let _ = app.emit(
        "host-tunnel-status",
        serde_json::json!({
            "step": "ready",
            "message": "Tunnel connected! Ready to stream.",
            "streamUrl": stream_url
        }),
    );

    {
        let mut guard = state.lock().await;
        guard.cloudflared_child = Some(cf_child);
    }

    Ok(TunnelResult {
        stream_url,
        local_stream_url,
        tunnel_url: tunnel_base_url,
        file_name,
        file_size,
        duration,
        is_hls,
        stream_mode: selected_mode,
        subtitle_url,
        subtitle_tracks,
        audio_tracks: probe.audio_tracks,
    })
}

#[tauri::command]
pub async fn get_audio_tracks(video_path: Option<String>) -> Result<Vec<AudioTrackInfo>, String> {
    let path_str = match video_path {
        Some(p) if !p.is_empty() => p,
        _ => return Ok(Vec::new()),
    };
    let probe = probe_video_file(&path_str).await;
    Ok(probe.audio_tracks)
}

#[tauri::command]
pub async fn get_subtitle_tracks(video_path: Option<String>) -> Result<Vec<SubtitleTrackInfo>, String> {
    let path_str = match video_path {
        Some(p) if !p.is_empty() => p,
        _ => return Ok(Vec::new()),
    };
    let probe = probe_video_file(&path_str).await;
    Ok(probe.subtitle_streams)
}
