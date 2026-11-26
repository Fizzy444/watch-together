use axum::body::Body;
use axum::extract::{Path as AxumPath, Request, State as AxumState};
use axum::http::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, HeaderName,
    HeaderValue,
};
use axum::http::{Response, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::fs as tokio_fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeFile;

const HLS_SEGMENT_DURATION: f64 = 4.0;
const HLS_JUMP_LOOKBEHIND_SECS: f64 = 8.0;
const HLS_PREFETCH_LOOKAHEAD_SECS: f64 = 24.0;
const HLS_SEGMENT_WAIT_TIMEOUT_MS: u64 = 12_000;
const HLS_TARGET_DURATION: u64 = 16;

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

#[derive(Clone, Debug)]
struct HlsRealSegment {
    file_path: PathBuf,
    start_sec: f64,
    end_sec: f64,
    generation: u64,
}

struct HlsRuntimeState {
    ffmpeg_child: Option<tokio::process::Child>,
    generation: u64,
    active_cursor_start: f64,
    base_mux_offset_by_variant: HashMap<String, f64>,
    gen_start_by_key: HashMap<(u64, String), f64>,
    segments_by_variant: HashMap<String, Vec<HlsRealSegment>>,
    indexed_files: HashSet<PathBuf>,
    shutdown: bool,
}

pub struct HlsController {
    video_path: String,
    hls_dir: PathBuf,
    duration: f64,
    needs_video_transcode: bool,
    audio_tracks: Vec<AudioTrackInfo>,
    state: Mutex<HlsRuntimeState>,
    spawn_lock: Mutex<()>,
}

#[derive(Default)]
pub struct ActiveTunnelState {
    pub server_shutdown: Option<oneshot::Sender<()>>,
    pub cloudflared_child: Option<tokio::process::Child>,
    pub ffmpeg_child: Option<tokio::process::Child>,
    pub hls_controller: Option<Arc<HlsController>>,
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
    let is_success = response.status().is_success();
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
        let cache_val = if is_success {
            "public, max-age=31536000, immutable"
        } else {
            "no-cache, no-store, must-revalidate"
        };
        headers.insert(CACHE_CONTROL, HeaderValue::from_static(cache_val));
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
    let (legacy_child, hls_controller, temp_remux, hls_dir, cloudflared_child, server_shutdown) = {
        let mut guard = state.lock().await;
        guard.current_video_path = None;
        guard.stream_mode = None;
        guard.needs_video_transcode = false;
        (
            guard.ffmpeg_child.take(),
            guard.hls_controller.take(),
            guard.current_temp_remux.take(),
            guard.hls_dir.take(),
            guard.cloudflared_child.take(),
            guard.server_shutdown.take(),
        )
    };

    if let Some(mut child) = legacy_child {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    if let Some(ctrl) = hls_controller {
        let mut h_state = ctrl.state.lock().await;
        h_state.shutdown = true;
        if let Some(mut child) = h_state.ffmpeg_child.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    if let Some(temp_path) = temp_remux {
        let _ = fs::remove_file(temp_path);
    }

    if let Some(hls_dir) = hls_dir {
        let _ = fs::remove_dir_all(hls_dir);
    }

    if let Some(mut child) = cloudflared_child {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    if let Some(shutdown) = server_shutdown {
        let _ = shutdown.send(());
    }
}

#[tauri::command]
pub async fn stop_host_tunnel(
    state: tauri::State<'_, SharedTunnelState>,
) -> Result<bool, String> {
    cleanup_tunnel(&state).await;
    Ok(true)
}

fn build_unique_var_stream_map(audio_tracks: &[AudioTrackInfo]) -> String {
    let mut var_stream_parts = vec!["v:0,agroup:audio".to_string()];
    let mut used_names: HashSet<String> = HashSet::new();
    for (idx, track) in audio_tracks.iter().enumerate() {
        let lang = if track.language.is_empty() {
            "und"
        } else {
            track.language.as_str()
        };
        let default_str =
            if track.is_default || (idx == 0 && !audio_tracks.iter().any(|t| t.is_default)) {
                "yes"
            } else {
                "no"
            };
        let mut clean_name = track
            .label
            .replace(|c: char| !c.is_alphanumeric() && c != '_', "_");
        if clean_name.is_empty() {
            clean_name = format!("Track_{}", idx + 1);
        }
        if !used_names.insert(clean_name.clone()) {
            clean_name = format!("{clean_name}_{idx}");
            used_names.insert(clean_name.clone());
        }
        var_stream_parts.push(format!(
            "a:{idx},agroup:audio,language:{lang},name:{clean_name},default:{default_str}"
        ));
    }
    var_stream_parts.join(" ")
}

fn spawn_hls_ffmpeg(
    video_path: &str,
    hls_dir: &Path,
    start_seconds: f64,
    generation: u64,
    needs_video_transcode: bool,
    audio_tracks: &[AudioTrackInfo],
) -> Result<tokio::process::Child, String> {
    let mut args = vec![
        "-y".to_string(),
        "-fflags".to_string(),
        "+genpts".to_string(),
    ];

    if start_seconds > 0.0 {
        args.push("-ss".to_string());
        args.push(format!("{:.3}", start_seconds));
    }

    args.extend([
        "-i".to_string(),
        video_path.to_string(),
        "-map".to_string(),
        "0:v:0".to_string(),
    ]);

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
            "-force_key_frames".to_string(),
            format!("expr:gte(t,n_forced*{})", HLS_SEGMENT_DURATION as u64),
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
        "-copyts".to_string(),
        "-f".to_string(),
        "hls".to_string(),
        "-hls_time".to_string(),
        format!("{}", HLS_SEGMENT_DURATION as u64),
        "-hls_list_size".to_string(),
        "0".to_string(),
        "-hls_flags".to_string(),
        "independent_segments+temp_file".to_string(),
        "-hls_segment_type".to_string(),
        "mpegts".to_string(),
    ]);

    if audio_tracks.len() > 1 {
        let var_stream_map = build_unique_var_stream_map(audio_tracks);
        if generation == 1 {
            args.extend(["-master_pl_name".to_string(), "raw_master.m3u8".to_string()]);
        }
        args.extend([
            "-var_stream_map".to_string(),
            var_stream_map,
            "-hls_segment_filename".to_string(),
            hls_dir
                .join(format!("e{generation}_v%v_%05d.ts"))
                .to_string_lossy()
                .to_string(),
            hls_dir
                .join(format!("part_{generation}_v%v.m3u8"))
                .to_string_lossy()
                .to_string(),
        ]);
    } else {
        let playlist_path = hls_dir.join(format!("part_{generation}_default.m3u8"));
        let segment_pattern = hls_dir
            .join(format!("e{generation}_%05d.ts"))
            .to_string_lossy()
            .to_string();
        args.extend([
            "-hls_segment_filename".to_string(),
            segment_pattern,
            playlist_path.to_string_lossy().to_string(),
        ]);
    }

    let mut cmd = Command::new("ffmpeg");
    cmd.args(&args).stdout(Stdio::null()).stderr(Stdio::null());

    cmd.spawn()
        .map_err(|e| format!("Failed to spawn ffmpeg for HLS: {e}"))
}

async fn probe_segment_start_time(file_path: &Path) -> Option<f64> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=start_time",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            &file_path.to_string_lossy(),
        ])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    text.trim().parse::<f64>().ok()
}

fn parse_part_filename(name: &str) -> Option<(u64, String)> {
    let trimmed = name.strip_prefix("part_")?.strip_suffix(".m3u8")?;
    let (gen_str, rest) = trimmed.split_once('_')?;
    let epoch_gen = gen_str.parse::<u64>().ok()?;
    let variant = if rest == "default" {
        "default".to_string()
    } else {
        rest.strip_prefix('v')?.to_string()
    };
    Some((epoch_gen, variant))
}

async fn sync_hls_segments(ctrl: &HlsController) {
    let entries = match fs::read_dir(&ctrl.hls_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    let mut part_files: Vec<(u64, String, PathBuf)> = Vec::new();
    for entry in entries.flatten() {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if let Some((epoch_gen, variant)) = parse_part_filename(&file_name) {
            part_files.push((epoch_gen, variant, entry.path()));
        }
    }
    part_files.sort_by_key(|(epoch_gen, _, _)| *epoch_gen);

    let (known_gen_keys, known_indexed_files, active_cursor_start) = {
        let state = ctrl.state.lock().await;
        (
            state.gen_start_by_key.keys().cloned().collect::<HashSet<_>>(),
            state.indexed_files.clone(),
            state.active_cursor_start,
        )
    };

    let mut pending_probes: Vec<(u64, String, PathBuf)> = Vec::new();
    let mut parsed_entries: Vec<(u64, String, Vec<(f64, PathBuf)>)> = Vec::new();

    for (epoch_gen, variant, path) in &part_files {
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        let lines: Vec<&str> = text.lines().collect();
        let mut items: Vec<(f64, PathBuf)> = Vec::new();
        let mut i = 0;
        while i < lines.len() {
            if let Some(dur_raw) = lines[i].strip_prefix("#EXTINF:") {
                let dur = dur_raw
                    .split(',')
                    .next()
                    .and_then(|s| s.trim().parse::<f64>().ok())
                    .unwrap_or(HLS_SEGMENT_DURATION);
                if let Some(seg_name) = lines.get(i + 1).map(|s| s.trim()) {
                    if seg_name.ends_with(".ts") {
                        let seg_path = ctrl.hls_dir.join(seg_name);
                        if known_indexed_files.contains(&seg_path) || seg_path.exists() {
                            items.push((dur, seg_path));
                        }
                    }
                }
                i += 2;
                continue;
            }
            i += 1;
        }
        if let Some((_, first_path)) = items.first() {
            if !known_gen_keys.contains(&(*epoch_gen, variant.clone())) {
                pending_probes.push((*epoch_gen, variant.clone(), first_path.clone()));
            }
        }
        parsed_entries.push((*epoch_gen, variant.clone(), items));
    }

    let mut probed_starts: HashMap<(u64, String), Option<f64>> = HashMap::new();
    for (epoch_gen, variant, seg_path) in pending_probes {
        let raw_start = probe_segment_start_time(&seg_path).await;
        probed_starts.insert((epoch_gen, variant), raw_start);
    }

    let mut state = ctrl.state.lock().await;
    for ((epoch_gen, variant), raw_start_opt) in probed_starts {
        let Some(raw_start) = raw_start_opt else {
            let fallback_start = if epoch_gen == 1 { 0.0 } else { active_cursor_start };
            state
                .gen_start_by_key
                .entry((epoch_gen, variant))
                .or_insert(fallback_start);
            continue;
        };
        if epoch_gen == 1 && !state.base_mux_offset_by_variant.contains_key(&variant) {
            state
                .base_mux_offset_by_variant
                .insert(variant.clone(), raw_start);
        }
        let base_mux = state
            .base_mux_offset_by_variant
            .get(&variant)
            .or_else(|| state.base_mux_offset_by_variant.get("0"))
            .or_else(|| state.base_mux_offset_by_variant.get("default"))
            .or_else(|| state.base_mux_offset_by_variant.values().next())
            .copied()
            .unwrap_or(raw_start);
        state
            .gen_start_by_key
            .insert((epoch_gen, variant), (raw_start - base_mux).max(0.0));
    }

    for (epoch_gen, variant, items) in parsed_entries {
        let Some(&base_start) = state.gen_start_by_key.get(&(epoch_gen, variant.clone())) else {
            continue;
        };
        let mut cursor = base_start;
        for (dur, seg_path) in items {
            let end = cursor + dur;
            if !state.indexed_files.contains(&seg_path) {
                state.indexed_files.insert(seg_path.clone());
                state
                    .segments_by_variant
                    .entry(variant.clone())
                    .or_default()
                    .push(HlsRealSegment {
                        file_path: seg_path,
                        start_sec: cursor,
                        end_sec: end,
                        generation: epoch_gen,
                    });
            }
            cursor = end;
        }
    }
}

fn find_segment_for_time(segments: &[HlsRealSegment], target_sec: f64) -> Option<HlsRealSegment> {
    let mut best_match: Option<&HlsRealSegment> = None;
    for seg in segments {
        if seg.start_sec <= target_sec + 0.05 && target_sec < seg.end_sec - 0.05 {
            if best_match.map_or(true, |b| seg.generation > b.generation) {
                best_match = Some(seg);
            }
        }
    }
    if let Some(found) = best_match {
        return Some(found.clone());
    }
    let mut fallback: Option<&HlsRealSegment> = None;
    for seg in segments {
        if (seg.start_sec - target_sec).abs() <= 2.5 {
            if fallback.map_or(true, |b| seg.generation > b.generation) {
                fallback = Some(seg);
            }
        }
    }
    fallback.cloned()
}

pub fn build_virtual_vod_playlist(duration: f64, seg_prefix: &str) -> String {
    let total_segs = if duration > 0.0 {
        ((duration / HLS_SEGMENT_DURATION).ceil() as usize).max(1)
    } else {
        1
    };
    let mut out = format!(
        "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:{HLS_TARGET_DURATION}\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n"
    );
    for i in 0..total_segs {
        let seg_dur = if duration > 0.0 {
            (duration - (i as f64) * HLS_SEGMENT_DURATION).clamp(0.1, HLS_SEGMENT_DURATION)
        } else {
            HLS_SEGMENT_DURATION
        };
        out.push_str(&format!("#EXTINF:{seg_dur:.3},\n{seg_prefix}_{i:05}.ts\n"));
    }
    out.push_str("#EXT-X-ENDLIST\n");
    out
}

pub fn rewrite_master_playlist_for_vod(raw_master: &str) -> String {
    static MASTER_PART_RE: OnceLock<Regex> = OnceLock::new();
    let re = MASTER_PART_RE.get_or_init(|| Regex::new(r"part_1_v([^\s\x22']+)\.m3u8").unwrap());
    re.replace_all(raw_master, "vod_v$1.m3u8").into_owned()
}

async fn jump_ffmpeg_if_needed(
    ctrl: &Arc<HlsController>,
    variant: &str,
    target_sec: f64,
    force_check_active: bool,
) -> Option<(u64, Option<PathBuf>)> {
    let _spawn_guard = ctrl.spawn_lock.lock().await;
    sync_hls_segments(ctrl).await;

    let old_child: Option<tokio::process::Child>;
    let next_gen: u64;
    let jump_start: f64;

    {
        let mut state = ctrl.state.lock().await;
        if state.shutdown {
            return None;
        }
        if let Some(segments) = state.segments_by_variant.get(variant) {
            if let Some(found) = find_segment_for_time(segments, target_sec) {
                return Some((found.generation, Some(found.file_path)));
            }
        }
        let max_active = state
            .segments_by_variant
            .get(variant)
            .map(|segs| {
                segs.iter()
                    .filter(|s| s.generation == state.generation)
                    .map(|s| s.end_sec)
                    .fold(state.active_cursor_start, f64::max)
            })
            .unwrap_or(state.active_cursor_start);

        let needs_jump = target_sec < state.active_cursor_start
            || (force_check_active && target_sec > max_active + HLS_PREFETCH_LOOKAHEAD_SECS);
        if !needs_jump {
            return Some((state.generation, None));
        }

        old_child = state.ffmpeg_child.take();
        state.generation += 1;
        next_gen = state.generation;
        jump_start = (target_sec - HLS_JUMP_LOOKBEHIND_SECS).max(0.0);
        state.active_cursor_start = jump_start;
    }

    if let Some(mut child) = old_child {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    let new_child = match spawn_hls_ffmpeg(
        &ctrl.video_path,
        &ctrl.hls_dir,
        jump_start,
        next_gen,
        ctrl.needs_video_transcode,
        &ctrl.audio_tracks,
    ) {
        Ok(c) => c,
        Err(_) => return None,
    };

    {
        let mut state = ctrl.state.lock().await;
        if state.shutdown {
            drop(state);
            let mut c = new_child;
            let _ = c.kill().await;
            let _ = c.wait().await;
            return None;
        }
        if state.generation == next_gen {
            state.ffmpeg_child = Some(new_child);
        } else {
            let mut c = new_child;
            let _ = c.kill().await;
        }
    }

    Some((next_gen, None))
}

async fn ensure_hls_segment(
    ctrl: &Arc<HlsController>,
    variant: &str,
    target_sec: f64,
) -> Option<PathBuf> {
    sync_hls_segments(ctrl).await;
    {
        let state = ctrl.state.lock().await;
        if let Some(segments) = state.segments_by_variant.get(variant) {
            if let Some(found) = find_segment_for_time(segments, target_sec) {
                return Some(found.file_path);
            }
        }
    }

    let (wait_gen, immediate) = jump_ffmpeg_if_needed(ctrl, variant, target_sec, true).await?;
    if let Some(path) = immediate {
        return Some(path);
    }

    let deadline = Instant::now() + Duration::from_millis(HLS_SEGMENT_WAIT_TIMEOUT_MS);
    while Instant::now() < deadline {
        sync_hls_segments(ctrl).await;
        let mut child_finished = false;
        {
            let mut state = ctrl.state.lock().await;
            if state.shutdown || state.generation != wait_gen {
                return None;
            }
            if let Some(segments) = state.segments_by_variant.get(variant) {
                if let Some(found) = find_segment_for_time(segments, target_sec) {
                    return Some(found.file_path);
                }
            }
            if let Some(child) = state.ffmpeg_child.as_mut() {
                if let Ok(Some(_)) = child.try_wait() {
                    child_finished = true;
                }
            }
        }
        if child_finished {
            sync_hls_segments(ctrl).await;
            let state = ctrl.state.lock().await;
            return state
                .segments_by_variant
                .get(variant)
                .and_then(|segs| find_segment_for_time(segs, target_sec))
                .map(|s| s.file_path);
        }
        tokio::time::sleep(Duration::from_millis(60)).await;
    }

    None
}

async fn serve_hls_request(
    AxumState(ctrl): AxumState<Arc<HlsController>>,
    AxumPath(file): AxumPath<String>,
) -> impl IntoResponse {
    if file.is_empty() || file.contains("..") || file.contains('/') || file.contains('\\') {
        return (StatusCode::BAD_REQUEST, "Invalid path").into_response();
    }

    if file == "stream.m3u8" {
        if ctrl.audio_tracks.len() > 1 {
            let raw_master_path = ctrl.hls_dir.join("raw_master.m3u8");
            if let Ok(raw) = tokio_fs::read_to_string(raw_master_path).await {
                let body = rewrite_master_playlist_for_vod(&raw);
                return (
                    StatusCode::OK,
                    [(CONTENT_TYPE, "application/vnd.apple.mpegurl")],
                    body,
                )
                    .into_response();
            }
            return (StatusCode::NOT_FOUND, "Playlist not ready").into_response();
        }
        let body = build_virtual_vod_playlist(ctrl.duration, "vod_default");
        return (
            StatusCode::OK,
            [(CONTENT_TYPE, "application/vnd.apple.mpegurl")],
            body,
        )
            .into_response();
    }

    if let Some(variant) = file.strip_prefix("vod_v").and_then(|s| s.strip_suffix(".m3u8")) {
        let prefix = format!("vod_v{variant}");
        let body = build_virtual_vod_playlist(ctrl.duration, &prefix);
        return (
            StatusCode::OK,
            [(CONTENT_TYPE, "application/vnd.apple.mpegurl")],
            body,
        )
            .into_response();
    }

    if let Some(stem) = file.strip_prefix("vod_").and_then(|s| s.strip_suffix(".ts")) {
        if let Some((var_part, idx_str)) = stem.rsplit_once('_') {
            if let Ok(seg_idx) = idx_str.parse::<usize>() {
                let variant = if var_part == "default" {
                    "default"
                } else {
                    var_part.strip_prefix('v').unwrap_or(var_part)
                };
                let target_sec = (seg_idx as f64) * HLS_SEGMENT_DURATION;
                if let Some(seg_path) = ensure_hls_segment(&ctrl, variant, target_sec).await {
                    if let Ok(bytes) = tokio_fs::read(&seg_path).await {
                        return (StatusCode::OK, [(CONTENT_TYPE, "video/mp2t")], bytes)
                            .into_response();
                    }
                }
                return (StatusCode::SERVICE_UNAVAILABLE, "Segment generating").into_response();
            }
        }
    }

    let static_path = ctrl.hls_dir.join(&file);
    if let Ok(bytes) = tokio_fs::read(&static_path).await {
        let content_type = if file.ends_with(".vtt") {
            "text/vtt; charset=utf-8"
        } else if file.ends_with(".json") {
            "application/json"
        } else if file.ends_with(".m3u8") {
            "application/vnd.apple.mpegurl"
        } else if file.ends_with(".ts") {
            "video/mp2t"
        } else {
            "application/octet-stream"
        };
        return (StatusCode::OK, [(CONTENT_TYPE, content_type)], bytes).into_response();
    }

    (StatusCode::NOT_FOUND, "Not found").into_response()
}

#[tauri::command]
pub async fn seek_hls_stream(
    state: tauri::State<'_, SharedTunnelState>,
    target_seconds: f64,
) -> Result<bool, String> {
    let ctrl = {
        let guard = state.lock().await;
        guard.hls_controller.clone()
    };
    let Some(ctrl) = ctrl else {
        return Ok(true);
    };
    let primary_variant = if ctrl.audio_tracks.len() > 1 {
        "0"
    } else {
        "default"
    };
    let clamped_target = if ctrl.duration > 0.0 {
        target_seconds.clamp(0.0, ctrl.duration)
    } else {
        target_seconds.max(0.0)
    };
    let _ = jump_ffmpeg_if_needed(&ctrl, primary_variant, clamped_target, true).await;
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
    let mut active_hls_controller: Option<Arc<HlsController>> = None;

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
            1,
            probe.needs_video_transcode,
            &probe.audio_tracks,
        ) {
            Ok(child) => child,
            Err(error) => {
                let _ = fs::remove_dir_all(&hls_dir);
                return Err(error);
            }
        };

        let controller = Arc::new(HlsController {
            video_path: file_path.clone(),
            hls_dir: hls_dir.clone(),
            duration,
            needs_video_transcode: probe.needs_video_transcode,
            audio_tracks: probe.audio_tracks.clone(),
            state: Mutex::new(HlsRuntimeState {
                ffmpeg_child: Some(child),
                generation: 1,
                active_cursor_start: 0.0,
                base_mux_offset_by_variant: HashMap::new(),
                gen_start_by_key: HashMap::new(),
                segments_by_variant: HashMap::new(),
                indexed_files: HashSet::new(),
                shutdown: false,
            }),
            spawn_lock: Mutex::new(()),
        });

        {
            let mut guard = state.lock().await;
            guard.hls_controller = Some(controller.clone());
            guard.hls_dir = Some(hls_dir.clone());
            guard.current_video_path = Some(file_path.clone());
            guard.stream_mode = Some("hls".to_string());
            guard.needs_video_transcode = probe.needs_video_transcode;
        }

        let primary_variant = if probe.audio_tracks.len() > 1 {
            "0"
        } else {
            "default"
        };
        let multi_audio = probe.audio_tracks.len() > 1;
        let master_path = hls_dir.join("raw_master.m3u8");
        let mut playlist_ready = false;

        for _ in 0..80 {
            sync_hls_segments(&controller).await;
            let has_master = !multi_audio || master_path.exists();
            let (has_primary_seg, failed_status) = {
                let mut h_state = controller.state.lock().await;
                let has_seg = h_state
                    .segments_by_variant
                    .get(primary_variant)
                    .map_or(false, |v| !v.is_empty());
                let exited = if !has_seg {
                    h_state
                        .ffmpeg_child
                        .as_mut()
                        .and_then(|c| c.try_wait().ok().flatten())
                } else {
                    None
                };
                (has_seg, exited)
            };

            if has_master && has_primary_seg {
                playlist_ready = true;
                break;
            }
            if let Some(status) = failed_status {
                cleanup_tunnel(&state).await;
                return Err(format!(
                    "FFmpeg failed to initialize HLS stream (exit code: {status})"
                ));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        if !playlist_ready {
            cleanup_tunnel(&state).await;
            return Err("Timed out waiting for HLS playlist generation".to_string());
        }

        active_hls_dir = Some(hls_dir);
        active_hls_controller = Some(controller);
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

    if let Some(ctrl) = active_hls_controller {
        router = router.route(
            "/hls/{file}",
            axum::routing::get(serve_hls_request).with_state(ctrl),
        );
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
