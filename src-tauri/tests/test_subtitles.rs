use std::fs;
use std::path::{Path, PathBuf};

fn scan_directory_subtitles(video_path: &Path) -> Vec<(String, String)> {
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

            tracks.push((file_name, content));
        }
    }

    tracks
}

#[test]
fn test_subtitle_matching() {
    let video_path = PathBuf::from("../test_assets/sample.mp4")
        .canonicalize()
        .expect("Canonicalize test video");

    let results = scan_directory_subtitles(&video_path);
    assert!(!results.is_empty(), "Should find matching subtitle file");
    let (name, content) = &results[0];
    assert!(name.contains("sample.en.srt"));
    assert!(content.contains("Hello, Watch Together Rust!"));
    println!("Test passed: subtitle matched: {name}");
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
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

#[test]
fn test_subtitle_track_info_serialization() {
    let track = SubtitleTrackInfo {
        id: "sub-0".to_string(),
        stream_index: Some(2),
        language: "en".to_string(),
        label: "English (SDH)".to_string(),
        url: "http://localhost:8080/hls/subtitles_0_en.vtt".to_string(),
        is_default: true,
    };

    let json = serde_json::to_string(&track).expect("Serialize subtitle track");
    assert!(json.contains("\"streamIndex\":2"));
    assert!(json.contains("\"language\":\"en\""));
    assert!(json.contains("\"label\":\"English (SDH)\""));
    assert!(json.contains("\"isDefault\":true"));

    let deserialized: SubtitleTrackInfo = serde_json::from_str(&json).expect("Deserialize subtitle track");
    assert_eq!(deserialized.id, "sub-0");
    assert_eq!(deserialized.language, "en");
    assert_eq!(deserialized.label, "English (SDH)");
}
