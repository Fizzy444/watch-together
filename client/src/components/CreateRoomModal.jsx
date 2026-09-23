import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createRoom } from "../api/index.js";
import { getSessionClientId } from "../hooks/useWebSocket.js";
import { X, Film, Loader2, Zap, Upload } from "lucide-react";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

export default function CreateRoomModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");
  const [localFile, setLocalFile] = useState(null);
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

      // Store file in window memory for instant pickup in Room page
      window.__wt_p2p_file = localFile;

      onClose();
      navigate(`/watch/${room.roomId}`);
    } catch (err) {
      setError(err.message || "Failed to create P2P room");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "var(--r-sm)",
                background: "rgba(234, 179, 8, 0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#eab308",
              }}
            >
              <Zap size={16} />
            </div>
            <h3 style={{ margin: 0, fontSize: "1.0625rem" }}>Create Watch Room</h3>
          </div>
          <button className="btn-icon" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleCreate}>
          <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
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
                placeholder={localFile ? localFile.name.replace(/\.[^/.]+$/, "") : "e.g. Movie Night with Friends"}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                autoFocus
                maxLength={60}
              />
              <span style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>
                Optional. Defaults to the movie title if left blank.
              </span>
            </div>

            {/* Choose Video File from Device */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-1)" }}>
                Choose Video from Device
              </label>

              <input
                type="file"
                ref={fileInputRef}
                accept=".mp4,.mkv,.webm,.mov,.avi"
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
                  Streams directly from your device to friends via WebRTC. Never uploaded to the server.
                </span>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !localFile}
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              {loading ? (
                <>
                  <Loader2 className="spinner" size={16} /> Creating...
                </>
              ) : (
                <>
                  <Zap size={15} /> Create & Broadcast P2P
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
