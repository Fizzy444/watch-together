use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub file_name: String,
    pub file_path: String,
    pub format: String,
    pub content: String,
    pub is_embedded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_index: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_number: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_auto_detected: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleFileInfo {
    pub file_path: String,
    pub file_name: String,
    pub format: String,
    pub content: String,
}

#[derive(Deserialize)]
struct FfprobeSubtitleOutput {
    streams: Option<Vec<FfprobeSubtitleStream>>,
}

#[derive(Deserialize)]
struct FfprobeSubtitleStream {
    index: u32,
    tags: Option<serde_json::Value>,
}

fn extract_stream_vtt(file_path: &str, stream_index: u32) -> Option<String> {
    let output = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-i",
            file_path,
            "-map",
            &format!("0:{stream_index}"),
            "-f",
            "webvtt",
            "-",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if text.trim().is_empty() {
        return None;
    }
    Some(text)
}

fn probe_embedded_subtitles(file_path: &str) -> Vec<SubtitleTrack> {
    let mut tracks = Vec::new();
    let probe_output = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "s",
            "-show_entries",
            "stream=index,codec_name:stream_tags=language,title",
            "-of",
            "json",
            file_path,
        ])
        .output();

    let output = match probe_output {
        Ok(out) if out.status.success() => out,
        _ => return tracks,
    };

    let parsed: FfprobeSubtitleOutput = match serde_json::from_slice(&output.stdout) {
        Ok(p) => p,
        Err(_) => return tracks,
    };

    let streams = match parsed.streams {
        Some(s) => s,
        None => return tracks,
    };

    for (idx, stream) in streams.into_iter().enumerate() {
        let vtt = match extract_stream_vtt(file_path, stream.index) {
            Some(v) => v,
            None => continue,
        };

        let lang = stream
            .tags
            .as_ref()
            .and_then(|t| t.get("language").or_else(|| t.get("LANGUAGE")))
            .and_then(|v| v.as_str())
            .unwrap_or("und")
            .to_string();

        let title = stream
            .tags
            .as_ref()
            .and_then(|t| t.get("title").or_else(|| t.get("TITLE")))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if lang != "und" {
                    format!("Track {} ({})", idx + 1, lang.to_uppercase())
                } else {
                    format!("Embedded Track {}", idx + 1)
                }
            });

        tracks.push(SubtitleTrack {
            file_name: title.clone(),
            file_path: file_path.to_string(),
            format: "vtt".to_string(),
            content: vtt,
            is_embedded: true,
            stream_index: Some(stream.index),
            track_number: Some((idx + 1) as u32),
            language: Some(lang),
            title: Some(title),
            is_auto_detected: None,
        });
    }

    tracks
}

fn scan_directory_subtitles(video_path: &Path) -> Vec<SubtitleTrack> {
    let mut tracks = Vec::new();
    let parent = match video_path.parent() {
        Some(p) => p,
        None => return tracks,
    };

    let stem = match video_path.file_stem().and_then(|s| s.to_str()) {
        Some(s) => s.to_lowercase(),
        None => return tracks,
    };

    let entries = match fs::read_dir(parent) {
        Ok(e) => e,
        Err(_) => return tracks,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e.to_lowercase(),
            None => continue,
        };

        if ext != "srt" && ext != "vtt" {
            continue;
        }

        let file_stem = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_lowercase(),
            None => continue,
        };

        if file_stem == stem || file_stem.starts_with(&stem) {
            let file_name = entry.file_name().to_string_lossy().to_string();
            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            tracks.push(SubtitleTrack {
                file_name,
                file_path: path.to_string_lossy().to_string(),
                format: ext,
                content,
                is_embedded: false,
                stream_index: None,
                track_number: None,
                language: None,
                title: None,
                is_auto_detected: Some(true),
            });
        }
    }

    tracks
}

#[tauri::command]
pub async fn find_matching_subtitles(
    video_path: Option<String>,
) -> Result<Vec<SubtitleTrack>, String> {
    let path_str = match video_path {
        Some(p) if !p.is_empty() => p,
        _ => return Ok(Vec::new()),
    };

    let path = PathBuf::from(&path_str);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let mut tracks = probe_embedded_subtitles(&path_str);
    let mut file_tracks = scan_directory_subtitles(&path);
    tracks.append(&mut file_tracks);
    Ok(tracks)
}

#[tauri::command]
pub async fn select_subtitle_file() -> Result<Option<SubtitleFileInfo>, String> {
    let handle = rfd::AsyncFileDialog::new()
        .set_title("Select Subtitle File (.srt, .vtt)")
        .add_filter("Subtitle Files", &["srt", "vtt"])
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
        .unwrap_or("subtitle")
        .to_string();

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_else(|| "vtt".to_string());

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;

    Ok(Some(SubtitleFileInfo {
        file_path: path.to_string_lossy().to_string(),
        file_name,
        format: ext,
        content,
    }))
}
