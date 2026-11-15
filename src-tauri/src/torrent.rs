use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStreamResult {
    pub stream_url: String,
    pub file_name: String,
    pub length: u64,
}

#[tauri::command]
pub async fn start_torrent(
    magnet_link: String,
) -> Result<TorrentStreamResult, String> {
    if magnet_link.trim().is_empty() {
        return Err("Magnet link cannot be empty".to_string());
    }

    Ok(TorrentStreamResult {
        stream_url: String::new(),
        file_name: "WebTorrent Stream".to_string(),
        length: 0,
    })
}

#[tauri::command]
pub async fn stop_torrent() -> Result<bool, String> {
    Ok(true)
}
