use std::path::PathBuf;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeFile;

#[tokio::test]
async fn test_serve_file_range() {
    let video_path = PathBuf::from("../test_assets/sample.mp4")
        .canonicalize()
        .expect("Canonicalize test video");
    let file_size = std::fs::metadata(&video_path).unwrap().len();

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("Bind port");
    let port = listener.local_addr().unwrap().port();

    let service = ServeFile::new(video_path.clone());
    let app = axum::Router::new()
        .route(
            "/health",
            axum::routing::get(|| async {
                axum::Json(serde_json::json!({ "status": "ok" }))
            }),
        )
        .nest_service("/video", service)
        .layer(CorsLayer::permissive());

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let mut stream = TcpStream::connect(format!("127.0.0.1:{port}"))
        .await
        .expect("Connect TCP");
    let req = format!("GET /video HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nRange: bytes=0-50\r\nConnection: close\r\n\r\n");
    stream.write_all(req.as_bytes()).await.expect("Write req");

    let mut res = Vec::new();
    stream.read_to_end(&mut res).await.expect("Read res");
    let res_str = String::from_utf8_lossy(&res);
    assert!(res_str.contains("206 Partial Content"));
    assert!(res_str.contains("content-range: bytes 0-50/"));
    assert!(res_str.contains(&format!("{file_size}")));
    println!("Test successfully verified: HTTP 206 Partial Content received!");
}
