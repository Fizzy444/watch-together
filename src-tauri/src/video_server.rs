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
use tower_http::services::ServeFile;

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
}

#[derive(Default)]
pub struct ActiveTunnelState {
    pub server_shutdown: Option<oneshot::Sender<()>>,
    pub cloudflared_child: Option<tokio::process::Child>,
    pub ffmpeg_child: Option<tokio::process::Child>,
    pub current_video_path: Option<String>,
    pub current_temp_remux: Option<PathBuf>,
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
    needs_audio_transcode: bool,
    is_mkv: bool,
    needs_video_transcode: bool,
}

async fn probe_video_file(file_path: &str) -> ProbeResult {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let is_mkv = ext == "mkv";

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
                needs_audio_transcode: false,
                is_mkv,
                needs_video_transcode: false,
            };
        }
    };

    let parsed: FfprobeOutput = match serde_json::from_slice(&probe_stdout) {
        Ok(p) => p,
        Err(_) => {
            return ProbeResult {
                duration: 0.0,
                needs_audio_transcode: false,
                is_mkv,
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
    let audio_streams: Vec<_> = streams
        .iter()
        .filter(|s| s.codec_type.as_deref() == Some("audio"))
        .collect();
    let video_streams: Vec<_> = streams
        .iter()
        .filter(|s| s.codec_type.as_deref() == Some("video"))
        .collect();

    let supported_audio: HashSet<&str> = ["aac", "mp3", "opus", "vorbis", "flac"]
        .into_iter()
        .collect();
    let supported_video: HashSet<&str> = ["h264", "avc1", "vp9", "av1"]
        .into_iter()
        .collect();

    let needs_audio_transcode = audio_streams.iter().any(|s| {
        let codec = s.codec_name.as_deref().unwrap_or("").to_lowercase();
        !supported_audio.contains(codec.as_str())
    });

    let needs_video_transcode = video_streams.first().map_or(false, |s| {
        let codec = s.codec_name.as_deref().unwrap_or("").to_lowercase();
        !supported_video.contains(codec.as_str())
    });

    ProbeResult {
        duration,
        needs_audio_transcode,
        is_mkv,
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

fn compute_file_hash(path: &Path, size: u64, mtime_ms: u128) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    size.hash(&mut hasher);
    mtime_ms.hash(&mut hasher);
    format!("{:x}", hasher.finish())
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

    if let Some(mut child) = guard.cloudflared_child.take() {
        let _ = child.kill().await;
    }

    if let Some(shutdown) = guard.server_shutdown.take() {
        let _ = shutdown.send(());
    }

    guard.current_video_path = None;
}

#[tauri::command]
pub async fn stop_host_tunnel(
    state: tauri::State<'_, SharedTunnelState>,
) -> Result<bool, String> {
    cleanup_tunnel(&state).await;
    Ok(true)
}

#[tauri::command]
pub async fn start_host_tunnel(
    app: AppHandle,
    state: tauri::State<'_, SharedTunnelState>,
    file_path: String,
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
    let needs_transmux = probe.needs_audio_transcode || probe.is_mkv || ext != "mp4" || probe.needs_video_transcode;

    let cache_dir = std::env::temp_dir().join("wt-cache");
    let _ = fs::create_dir_all(&cache_dir);

    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let file_hash = compute_file_hash(&path, file_size, mtime_ms);
    let cached_mp4_path = cache_dir.join(format!("{file_hash}.mp4"));
    let cached_mp4_tmp = cache_dir.join(format!("{file_hash}.tmp.mp4"));

    let mut target_file_path = path.clone();
    let mut target_file_size = file_size;

    if needs_transmux {
        if cached_mp4_path.exists() {
            target_file_size = fs::metadata(&cached_mp4_path).map(|m| m.len()).unwrap_or(file_size);
            target_file_path = cached_mp4_path;
        } else {
            let _ = app.emit(
                "host-tunnel-status",
                serde_json::json!({
                    "step": "transcoding",
                    "message": "Optimizing video for streaming (0%)...",
                    "progress": 0
                }),
            );

            {
                let mut guard = state.lock().await;
                guard.current_temp_remux = Some(cached_mp4_tmp.clone());
            }

            let mut ffmpeg_args = vec![
                "-y".to_string(),
                "-i".to_string(),
                file_path.clone(),
                "-map".to_string(),
                "0:v:0".to_string(),
                "-map".to_string(),
                "0:a:0?".to_string(),
            ];

            if probe.needs_video_transcode {
                ffmpeg_args.extend([
                    "-c:v".to_string(),
                    "libx264".to_string(),
                    "-preset".to_string(),
                    "ultrafast".to_string(),
                    "-crf".to_string(),
                    "22".to_string(),
                ]);
            } else {
                ffmpeg_args.extend(["-c:v".to_string(), "copy".to_string()]);
            }

            ffmpeg_args.extend([
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "192k".to_string(),
                "-ac".to_string(),
                "2".to_string(),
                "-movflags".to_string(),
                "+faststart".to_string(),
                cached_mp4_tmp.to_string_lossy().to_string(),
            ]);

            let mut cmd = Command::new("ffmpeg");
            cmd.args(&ffmpeg_args)
                .stdout(Stdio::null())
                .stderr(Stdio::piped());

            let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn ffmpeg: {e}"))?;
            let stderr = child.stderr.take().ok_or("Failed to open ffmpeg stderr")?;

            let app_clone = app.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                let time_re = Regex::new(r"time=(\d{2}):(\d{2}):(\d{2}\.\d+)").unwrap();

                while let Ok(Some(line)) = reader.next_line().await {
                    if let Some(caps) = time_re.captures(&line) {
                        if duration > 0.0 {
                            let h: f64 = caps[1].parse().unwrap_or(0.0);
                            let m: f64 = caps[2].parse().unwrap_or(0.0);
                            let s: f64 = caps[3].parse().unwrap_or(0.0);
                            let cur_sec = h * 3600.0 + m * 60.0 + s;
                            let percent = (cur_sec / duration * 100.0).round().clamp(0.0, 99.0) as u32;
                            let _ = app_clone.emit(
                                "host-tunnel-status",
                                serde_json::json!({
                                    "step": "transcoding",
                                    "message": format!("Optimizing video for streaming ({percent}%)..."),
                                    "progress": percent
                                }),
                            );
                        }
                    }
                }
            });

            let status = child.wait().await.map_err(|e| e.to_string())?;
            if status.success() && cached_mp4_tmp.exists() {
                let _ = fs::rename(&cached_mp4_tmp, &cached_mp4_path);
                target_file_size = fs::metadata(&cached_mp4_path).map(|m| m.len()).unwrap_or(file_size);
                target_file_path = cached_mp4_path;
            }
        }
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
    let service = ServeFile::new(target_file_path.clone());

    let server_app = axum::Router::new()
        .route(
            "/health",
            axum::routing::get({
                let f_name = file_name.clone();
                move || async move {
                    axum::Json(serde_json::json!({
                        "status": "ok",
                        "file": f_name,
                        "size": target_file_size,
                        "duration": duration,
                        "isHls": false
                    }))
                }
            }),
        )
        .route(
            "/info",
            axum::routing::get({
                let f_name = file_name.clone();
                move || async move {
                    axum::Json(serde_json::json!({
                        "status": "ok",
                        "file": f_name,
                        "size": target_file_size,
                        "duration": duration,
                        "isHls": false
                    }))
                }
            }),
        )
        .nest_service("/video", service)
        .layer(CorsLayer::permissive());

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
            "message": "Creating secure Cloudflare tunnel..."
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

    let stream_url = format!("{tunnel_base_url}/video");
    let local_stream_url = format!("http://127.0.0.1:{local_port}/video");

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
        guard.current_video_path = Some(file_path);
    }

    Ok(TunnelResult {
        stream_url,
        local_stream_url,
        tunnel_url: tunnel_base_url,
        file_name,
        file_size: target_file_size,
        duration,
        is_hls: false,
    })
}
