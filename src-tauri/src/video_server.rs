use axum::body::Body;
use axum::extract::Request;
use axum::http::header::{
    ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, HeaderName, HeaderValue,
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
    codec_type: Option<String>,
    codec_name: Option<String>,
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
}

async fn probe_video_file(file_path: &str) -> ProbeResult {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=index,codec_type,codec_name",
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

    let audio_streams: Vec<_> = streams
        .iter()
        .filter(|s| s.codec_type.as_deref() == Some("audio"))
        .collect();

    let needs_audio_transcode = audio_streams.first().map_or(false, |s| {
        let codec = s.codec_name.as_deref().unwrap_or("").to_lowercase();
        !supported_audio.contains(codec.as_str())
    });

    ProbeResult {
        duration,
        needs_video_transcode,
        needs_audio_transcode,
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
) -> Result<tokio::process::Child, String> {
    let playlist_path = hls_dir.join("stream.m3u8");
    let segment_pattern = hls_dir.join("seg_%03d.ts").to_string_lossy().to_string();

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
        "-map".to_string(),
        "0:a:0?".to_string(),
    ];

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
        "-hls_segment_filename".to_string(),
        segment_pattern,
        playlist_path.to_string_lossy().to_string(),
    ]);

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
            if ext == "mp4" || ext == "webm" {
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
            if ext == "mkv" || ext == "avi" || ext == "mov" || needs_transcode || needs_faststart {
                "hls".to_string()
            } else {
                "direct".to_string()
            }
        }
    };

    let mut subtitle_url: Option<String> = None;
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

        let vtt_path = hls_dir.join("subtitles.vtt");
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

        let child = match spawn_hls_ffmpeg(&file_path, &hls_dir, 0.0, probe.needs_video_transcode) {
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
        .expose_headers([CONTENT_RANGE, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_TYPE]);

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

        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(m) = url_re.find(&line) {
                let url = m.as_str().to_string();
                let mut lock = tx_ref.lock().await;
                if let Some(tx) = lock.take() {
                    let _ = tx.send(url);
                }
            }
            if line.contains("Error") || line.contains("error") {
                let _ = app_tunnel.emit(
                    "host-tunnel-status",
                    serde_json::json!({ "step": "error", "message": line }),
                );
            }
        }

        if tx_ref.lock().await.is_some() {
            let _ = app_tunnel.emit(
                "host-tunnel-status",
                serde_json::json!({
                    "step": "error",
                    "message": "Cloudflare tunnel exited before publishing a URL."
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

    let (stream_url, local_stream_url) = if is_hls {
        let s_url = format!("{tunnel_base_url}/hls/stream.m3u8");
        let l_url = format!("http://127.0.0.1:{local_port}/hls/stream.m3u8");
        if let Some(ref h_dir) = active_hls_dir {
            let vtt = h_dir.join("subtitles.vtt");
            if vtt.exists() && fs::metadata(&vtt).map(|m| m.len() > 10).unwrap_or(false) {
                subtitle_url = Some(format!("{tunnel_base_url}/hls/subtitles.vtt"));
            }
        }
        (s_url, l_url)
    } else {
        (
            format!("{tunnel_base_url}/video"),
            format!("http://127.0.0.1:{local_port}/video"),
        )
    };

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
    })
}
