use serde::{Deserialize, Serialize};

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

#[test]
fn test_audio_track_info_serialization() {
    let track = AudioTrackInfo {
        id: 0,
        stream_index: 1,
        codec_name: "aac".to_string(),
        language: "jpn".to_string(),
        label: "Japanese (Original)".to_string(),
        title: Some("Original".to_string()),
        is_default: true,
    };

    let json = serde_json::to_string(&track).expect("Serialize audio track");
    assert!(json.contains("\"streamIndex\":1"));
    assert!(json.contains("\"codecName\":\"aac\""));
    assert!(json.contains("\"language\":\"jpn\""));
    assert!(json.contains("\"label\":\"Japanese (Original)\""));
    assert!(json.contains("\"isDefault\":true"));

    let deserialized: AudioTrackInfo = serde_json::from_str(&json).expect("Deserialize audio track");
    assert_eq!(deserialized.id, 0);
    assert_eq!(deserialized.language, "jpn");
    assert_eq!(deserialized.label, "Japanese (Original)");
}
