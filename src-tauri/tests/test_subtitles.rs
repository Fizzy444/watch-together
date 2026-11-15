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
