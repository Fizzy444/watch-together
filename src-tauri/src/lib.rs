pub mod mp4;
pub mod subtitles;
pub mod torrent;
pub mod video_server;
pub mod window_controls;

use std::sync::Arc;
use tauri::WindowEvent;
use tokio::sync::Mutex;
use video_server::{cleanup_tunnel, ActiveTunnelState, SharedTunnelState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let tunnel_state: SharedTunnelState = Arc::new(Mutex::new(ActiveTunnelState::default()));
    let cleanup_state = tunnel_state.clone();

    tauri::Builder::default()
        .manage(tunnel_state)
        .invoke_handler(tauri::generate_handler![
            video_server::select_video_file,
            video_server::start_host_tunnel,
            video_server::stop_host_tunnel,
            video_server::seek_hls_stream,
            subtitles::select_subtitle_file,
            subtitles::find_matching_subtitles,
            torrent::start_torrent,
            torrent::stop_torrent,
            window_controls::window_minimize,
            window_controls::window_toggle_maximize,
            window_controls::window_close,
            window_controls::window_is_maximized,
        ])
        .on_window_event(move |_window, event| {
            if let WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed = event {
                let state_clone = cleanup_state.clone();
                tauri::async_runtime::spawn(async move {
                    cleanup_tunnel(&state_clone).await;
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
