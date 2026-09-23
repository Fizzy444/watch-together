import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api/index.js";
import { getSessionClientId } from "../hooks/useWebSocket.js";
import { addMovieToUserLibrary } from "../utils/library.js";
import UploadZone from "./UploadZone.jsx";
import { X, Film, Check, Plus, Loader2, Zap, HardDrive, Upload } from "lucide-react";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export default function CreateRoomModal({
  isOpen,
  onClose,
  movies = [],
  preselectedMovie = null,
  onMovieUploaded,
}) {
  const navigate = useNavigate();
  // Mode: "p2p" (stream local device file via WebRTC) | "server" (stream server library file)
  const [mode, setMode] = useState("p2p");
  const [roomName, setRoomName] = useState("");

  // P2P State
  const [localFile, setLocalFile] = useState(null);
  const fileInputRef = useRef(null);

  // Server Library State
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [showUpload, setShowUpload] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (preselectedMovie) {
      setMode("server");
      setSelectedMovie(preselectedMovie);
      setRoomName((prev) => (prev ? prev : preselectedMovie.name || ""));
    } else if (movies.length > 0 && !selectedMovie) {
      setSelectedMovie(movies[0]);
    }
  }, [preselectedMovie, movies]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalFile(file);
    if (!roomName.trim()) {
      const cleanName = file.name.replace(/\.[^/.]+$/, "");
      setRoomName(cleanName);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");

    if (mode === "p2p") {
      if (!localFile) {
        setError("Please choose a video file from your device to stream");
        return;
      }
      setLoading(true);
      try {
        const clientId = getSessionClientId();
        const finalTitle = roomName.trim() || localFile.name.replace(/\.[^/.]+$/, "");

        const room = await createRoom({
          isP2P: true,
          streamType: "p2p",
          movie: localFile.name,
          name: finalTitle,
          clientId,
        });

        // Store file in window memory for seamless pickup in Room page
        window.__wt_p2p_file = localFile;

        onClose();
        navigate(`/watch/${room.roomId}`, { state: { localFile } });
      } catch (err) {
        setError(err.message || "Failed to create P2P room");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Server Library Mode
    if (!selectedMovie) {
      setError("Please select a video file from library");
      return;
    }

    setLoading(true);
    try {
      const clientId = getSessionClientId();
      const room = await createRoom({
        movie: selectedMovie.filename,
        name: roomName.trim() || selectedMovie.name,
        clientId,
        streamType: "server",
      });
      addMovieToUserLibrary(selectedMovie.filename, movies);
      onClose();
      navigate(`/watch/${room.roomId}`);
    } catch (err) {
      setError(err.message || "Failed to create room");
    } finally {
      setLoading(false);
    }
  }

  function handleUploaded(updatedMovies) {
    onMovieUploaded?.(updatedMovies);
    setShowUpload(false);
    if (updatedMovies.length > 0) {
      const newest = updatedMovies[updatedMovies.length - 1];
      setSelectedMovie(newest);
      if (!roomName) setRoomName(newest.name);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>Create Watch Room</h3>
          <button className="btn-icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Source Mode Tabs */}
        <div style={{ padding: "0 var(--sp-4) var(--sp-2)", display: "flex", gap: "8px" }}>
          <button
            type="button"
            className={`btn btn-sm ${mode === "p2p" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setMode("p2p")}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
          >
            <Zap size={14} />
            <span>Stream Local File (P2P)</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${mode === "server" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setMode("server")}
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}
          >
            <HardDrive size={14} />
            <span>Server Library</span>
          </button>
        </div>

        <form onSubmit={handleCreate}>
          <div className="modal-body">
            {error && (
              <div
                style={{
                  padding: "var(--sp-2) var(--sp-3)",
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid var(--error)",
                  borderRadius: "var(--r-md)",
                  color: "var(--error)",
                  fontSize: "0.8125rem",
                }}
              >
                {error}
              </div>
            )}

            {/* Room Name Input */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-1)" }}>
                Room Name
              </label>
              <input
                type="text"
                className="input"
                placeholder={
                  mode === "p2p"
                    ? (localFile ? localFile.name.replace(/\.[^/.]+$/, "") : "e.g. Movie Night with Friends")
                    : (selectedMovie ? selectedMovie.name : "e.g. Movie Night with Friends")
                }
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                autoFocus
                maxLength={60}
              />
              <span style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>
                Optional. Defaults to the movie title if left blank.
              </span>
            </div>

            {/* MODE 1: P2P LOCAL FILE PICKER */}
            {mode === "p2p" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-1)" }}>
                  Select Video from Device
                </label>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept="video/*,.mp4,.mkv,.webm,.mov"
                  style={{ display: "none" }}
                  onChange={handleFileSelected}
                />

                {localFile ? (
                  <div
                    style={{
                      padding: "var(--sp-4)",
                      background: "rgba(16, 185, 129, 0.08)",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      borderRadius: "var(--r-md)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                      <Film size={22} color="var(--success)" style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "0.875rem",
                            fontWeight: 600,
                            color: "var(--text-1)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {localFile.name}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>
                          {formatBytes(localFile.size)} • Direct P2P Ready
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      padding: "var(--sp-6) var(--sp-4)",
                      background: "var(--bg)",
                      border: "1px dashed var(--border)",
                      borderRadius: "var(--r-md)",
                      textAlign: "center",
                      cursor: "pointer",
                      transition: "border-color 0.2s, background 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "var(--primary)";
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--border)";
                      e.currentTarget.style.background = "var(--bg)";
                    }}
                  >
                    <Upload size={28} color="var(--primary)" style={{ margin: "0 auto var(--sp-2)" }} />
                    <p style={{ fontWeight: 600, color: "var(--text-1)", fontSize: "0.875rem", marginBottom: "4px" }}>
                      Click to choose video file
                    </p>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-3)", margin: 0 }}>
                      MP4, WebM, MKV, MOV supported • 0 server upload • Instant play
                    </p>
                  </div>
                )}

                <div
                  style={{
                    padding: "8px 12px",
                    background: "rgba(234, 179, 8, 0.08)",
                    border: "1px solid rgba(234, 179, 8, 0.2)",
                    borderRadius: "var(--r-sm)",
                    fontSize: "0.75rem",
                    color: "#eab308",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Zap size={14} style={{ flexShrink: 0 }} />
                  <span>
                    Streamed directly from your browser to connected friends via WebRTC. Never saved on server.
                  </span>
                </div>
              </div>
            ) : (
              /* MODE 2: SERVER LIBRARY */
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-1)" }}>
                    Choose Video File
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: "0.75rem", padding: "0 var(--sp-2)" }}
                    onClick={() => setShowUpload((v) => !v)}
                  >
                    <Plus size={14} />
                    {showUpload ? "Pick from library" : "Upload new file"}
                  </button>
                </div>

                {showUpload ? (
                  <div style={{ padding: "var(--sp-2)", background: "var(--bg)", borderRadius: "var(--r-md)" }}>
                    <UploadZone onUploaded={handleUploaded} />
                  </div>
                ) : movies.length === 0 ? (
                  <div
                    style={{
                      padding: "var(--sp-6)",
                      background: "var(--bg)",
                      border: "1px dashed var(--border)",
                      borderRadius: "var(--r-md)",
                      textAlign: "center",
                      color: "var(--text-3)",
                      fontSize: "0.8125rem",
                    }}
                  >
                    <Film size={24} style={{ margin: "0 auto var(--sp-2)", opacity: 0.5 }} />
                    <p style={{ color: "var(--text-2)", marginBottom: "var(--sp-2)" }}>No movies in library</p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowUpload(true)}
                    >
                      Upload Video Now
                    </button>
                  </div>
                ) : (
                  <div className="movie-picker-list">
                    {movies.map((m) => {
                      const isSelected = selectedMovie?.id === m.id || selectedMovie?.filename === m.filename;
                      return (
                        <div
                          key={m.id}
                          className={`movie-picker-item ${isSelected ? "selected" : ""}`}
                          onClick={() => {
                            setSelectedMovie(m);
                            if (!roomName) setRoomName(m.name);
                          }}
                        >
                          <div className="movie-picker-radio">
                            {isSelected && <Check size={10} color="#000" />}
                          </div>
                          <Film size={18} color="var(--text-2)" style={{ flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: "0.8125rem",
                                fontWeight: isSelected ? 600 : 400,
                                color: "var(--text-1)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {m.name}
                            </div>
                            <div style={{ fontSize: "0.7rem", color: "var(--text-3)" }}>
                              {m.sizeFormatted}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || (mode === "p2p" ? !localFile : !selectedMovie)}
            >
              {loading ? (
                <>
                  <Loader2 className="spinner" size={16} /> Creating...
                </>
              ) : mode === "p2p" ? (
                "Create & Broadcast P2P"
              ) : (
                "Create & Enter Room"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
