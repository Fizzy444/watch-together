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
            };
        }
    };

    let parsed: FfprobeOutput = match serde_json::from_slice(&probe_stdout) {
        Ok(p) => p,
        Err(_) => {
            return ProbeResult {
                duration: 0.0,
                needs_video_transcode: false,
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

    let supported_video: HashSet<&str> = ["h264", "avc1", "vp9", "av1"]
        .into_iter()
        .collect();

    let needs_video_transcode = video_streams.first().map_or(false, |s| {
        let codec = s.codec_name.as_deref().unwrap_or("").to_lowercase();
        !supported_video.contains(codec.as_str())
    });

    ProbeResult {
        duration,
        needs_video_transcode,
    }
}

fn resolve_cloudflared_binary() -> PathBuf {
    let candidates = [
        "client/node_modules/cloudflared/bin/cloudflared.exe",
        "../client/node_modules/cloudflared/bin/cloudflared.exe",
        "client/node_modules/cloudflared/bin/cloudflared",
        "../client/node_modules/cloudflared/bin/cloudflared",
    ];

    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            if let Ok(abs) = path.canonicalize() {
                return abs;
            }
            return path;
        }
    }

    PathBuf::from(if cfg!(windows) { "cloudflared.exe" } else { "cloudflared" })
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

    Ok(Some(VideoFileInfo {
        file_path: path.to_string_lossy().to_string(),
        name: file_name.clone(),
        file_name,
        size,
        file_size: size,
    }))
}

pub async fn cleanup_tunnel(state: &SharedTunnelState) {
    let mut guard = state.lock().await;

    if let Some(mut child) = guard.ffmpeg_child.take() {
        let _ = child.kill().await;
    }

    if let Some(temp_path) = guard.current_temp_remux.take() {
        let _ = fs::remove_file(temp_path);
    }

    if let Some(hls_dir) = guard.hls_dir.take() {
        let _ = fs::remove_dir_all(hls_dir);
    }

    if let Some(mut child) = guard.cloudflared_child.take() {
        let _ = child.kill().await;
    }

    if let Some(shutdown) = guard.server_shutdown.take() {
        let _ = shutdown.send(());
    }

    guard.current_video_path = None;
    guard.stream_mode = None;
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
        "-f".to_string(),
        "hls".to_string(),
        "-hls_time".to_string(),
        "4".to_string(),
        "-hls_list_size".to_string(),
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
    state: tauri::State<'_, SharedTunnelState>,
    target_seconds: f64,
) -> Result<bool, String> {
    let mut guard = state.lock().await;
    let video_path = match &guard.current_video_path {
        Some(p) => p.clone(),
        None => return Err("No active video stream to seek".to_string()),
    };
    let hls_dir = match &guard.hls_dir {
        Some(d) => d.clone(),
        None => return Err("Active stream is not in HLS mode".to_string()),
    };

    if let Some(mut child) = guard.ffmpeg_child.take() {
        let _ = child.kill().await;
    }

    if let Ok(entries) = fs::read_dir(&hls_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().map_or(false, |ext| ext == "ts" || ext == "m3u8") {
                let _ = fs::remove_file(p);
            }
        }
    }

    let child = spawn_hls_ffmpeg(&video_path, &hls_dir, target_seconds, false)?;
    guard.ffmpeg_child = Some(child);

    let playlist_path = hls_dir.join("stream.m3u8");
    for _ in 0..40 {
        if playlist_path.exists() {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
    }

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

    let selected_mode = match stream_mode.as_deref() {
        Some("direct") => "direct".to_string(),
        Some("hls") => "hls".to_string(),
        _ => {
            if ext == "mkv" || ext == "avi" || ext == "mov" || probe.needs_video_transcode {
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

        let child = spawn_hls_ffmpeg(&file_path, &hls_dir, 0.0, probe.needs_video_transcode)?;

        {
            let mut guard = state.lock().await;
            guard.ffmpeg_child = Some(child);
            guard.hls_dir = Some(hls_dir.clone());
            guard.current_video_path = Some(file_path.clone());
            guard.stream_mode = Some("hls".to_string());
        }

        let playlist_path = hls_dir.join("stream.m3u8");
        for _ in 0..50 {
            if playlist_path.exists() {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
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
            axum::routing::get(|| async { axum::Json(serde_json::json!({ "status": "ok" })) }),
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
        .nest_service("/video", video_service);

    if let Some(ref h_dir) = active_hls_dir {
        router = router.nest_service("/hls", ServeDir::new(h_dir));
    }

    let server_app = router.layer(CorsLayer::permissive());

    tokio::spawn(async move {
        let _ = axum::serve(listener, server_app)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });

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
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut cf_child = cf_cmd
        .spawn()
        .map_err(|e| format!("Failed to launch cloudflared: {e}"))?;

    let stderr = cf_child.stderr.take().ok_or("Failed to read cloudflared stderr")?;

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
                    break;
                }
            }
            if line.contains("Error") || line.contains("error") {
                let _ = app_tunnel.emit(
                    "host-tunnel-status",
                    serde_json::json!({ "step": "error", "message": line }),
                );
            }
        }
    });

    let tunnel_base_url = tokio::time::timeout(std::time::Duration::from_secs(30), url_rx)
        .await
        .map_err(|_| "Timeout waiting for Cloudflare tunnel URL".to_string())?
        .map_err(|_| "Failed to obtain Cloudflare tunnel URL".to_string())?;

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
        guard.server_shutdown = Some(shutdown_tx);
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
