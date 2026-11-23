#[path = "../src/mp4.rs"]
mod mp4;

use std::path::PathBuf;

fn mp4_box(box_type: &[u8; 4], payload_size: usize) -> Vec<u8> {
    let size = (8 + payload_size) as u32;
    let mut bytes = size.to_be_bytes().to_vec();
    bytes.extend_from_slice(box_type);
    bytes.resize(8 + payload_size, 0);
    bytes
}

fn write_temp_mp4(name: &str, boxes: &[Vec<u8>]) -> PathBuf {
    let path = std::env::temp_dir().join(format!("wt-moov-test-{}-{name}.mp4", std::process::id()));
    let mut content = Vec::new();
    for box_bytes in boxes {
        content.extend_from_slice(box_bytes);
    }
    std::fs::write(&path, content).unwrap();
    path
}

#[test]
fn detects_moov_at_end_of_mp4() {
    let path = write_temp_mp4(
        "trailing-moov",
        &[
            mp4_box(b"ftyp", 8),
            mp4_box(b"mdat", 64),
            mp4_box(b"moov", 32),
        ],
    );

    assert!(mp4::needs_faststart(&path));

    std::fs::remove_file(path).unwrap();
}

#[test]
fn accepts_moov_at_start_of_mp4() {
    let path = write_temp_mp4(
        "leading-moov",
        &[
            mp4_box(b"ftyp", 8),
            mp4_box(b"moov", 32),
            mp4_box(b"mdat", 64),
        ],
    );

    assert!(!mp4::needs_faststart(&path));

    std::fs::remove_file(path).unwrap();
}
