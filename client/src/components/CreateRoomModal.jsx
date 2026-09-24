import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { X, Film, Upload, Zap, Loader2, Globe, Radio, ShieldCheck } from "lucide-react";
import { createRoom } from "../api/index.js";
import { getSessionClientId } from "../hooks/useWebSocket.js";

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
  const isElectron = Boolean(window.electronAPI);
  const [inputType, setInputType] = useState("tunnel");
  
  const [selectedFile, setSelectedFile] = useState(null); // { name, size, filePath }
  const [tunnelUrlInput, setTunnelUrlInput] = useState("");
  const [magnetLink, setMagnetLink] = useState("");
  const [localFile, setLocalFile] = useState(null);
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [tunnelStatusText, setTunnelStatusText] = useState("");
  const [error, setError] = useState("");

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen && !loading) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, loading]);

  if (!isOpen) return null;

  async function handlePickFile() {
    setError("");
    if (isElectron && window.electronAPI.selectVideoFile) {
      try {
        const res = await window.electronAPI.selectVideoFile();
        if (res) {
          setSelectedFile(res);
          if (!roomName.trim()) {
            setRoomName(res.fileName.replace(/\.[^/.]+$/, ""));
          }
        }
      } catch (err) {
        console.error("Failed to select file:", err);
        setError("Failed to open file picker: " + err.message);
      }
    } else {
      fileInputRef.current?.click();
    }
  }

  function handleBrowserFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLocalFile(file);
    setSelectedFile({
      name: file.name,
      size: file.size,
      filePath: null,
    });
    if (!roomName.trim()) {
      setRoomName(file.name.replace(/\.[^/.]+$/, ""));
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");

    if (inputType === "tunnel") {
      if (isElectron) {
        if (!selectedFile || !selectedFile.filePath) {
          setError("Please select a video file from your computer to stream via Cloudflare Tunnel.");
          return;
        }
      } else {
        if (!tunnelUrlInput.trim() && !selectedFile) {
          setError("Please provide a Cloudflare Tunnel URL or select a file.");
          return;
        }
      }
    } else if (inputType === "torrent") {
      if (!magnetLink.trim().startsWith("magnet:?")) {
        setError("Please enter a valid torrent magnet link starting with 'magnet:?'");
        return;
      }
    } else if (inputType === "local") {
      if (!localFile) {
        setError("Please choose a video file for P2P streaming.");
        return;
      }
    }

    setLoading(true);
    try {
      const clientId = getSessionClientId();
      let streamUrl = "";
      let finalMovieName = "";

      if (inputType === "tunnel") {
        if (isElectron && selectedFile?.filePath) {
          setTunnelStatusText("Starting local video streaming server...");
          
          const unsubscribe = window.electronAPI.onTunnelStatus?.((status) => {
            if (status.message) setTunnelStatusText(status.message);
          });

          try {
            const tunnelRes = await window.electronAPI.startHostTunnel(selectedFile.filePath);
            streamUrl = tunnelRes.streamUrl;
            finalMovieName = selectedFile.name.replace(/\.[^/.]+$/, "");
          } finally {
            unsubscribe?.();
          }
        } else {
          streamUrl = tunnelUrlInput.trim();
          finalMovieName = roomName.trim() || "Cloudflare Stream";
        }

        const finalTitle = roomName.trim() || finalMovieName;
        const room = await createRoom({
          streamType: "tunnel",
          movie: streamUrl,
          name: finalTitle,
          clientId,
        });

        onClose();
        navigate(`/watch/${room.roomId || room.id}`);
        return;
      }

      if (inputType === "torrent") {
        const dnMatch = magnetLink.match(/dn=([^&]+)/);
        const parsedTitle = dnMatch ? decodeURIComponent(dnMatch[1].replace(/\+/g, " ")) : "Torrent Stream";
        const finalTitle = roomName.trim() || parsedTitle;

        const room = await createRoom({
          streamType: "torrent",
          movie: magnetLink.trim(),
          name: finalTitle,
          clientId,
        });

        onClose();
        navigate(`/watch/${room.roomId || room.id}`);
        return;
      }

      if (inputType === "local") {
        const finalTitle = roomName.trim() || localFile.name.replace(/\.[^/.]+$/, "");
        const room = await createRoom({
          isP2P: true,
          streamType: "p2p",
          movie: localFile.name,
          name: finalTitle,
          clientId,
        });

        if (window.__wt_p2p_file_cache) {
          window.__wt_p2p_file_cache[room.roomId || room.id] = localFile;
        } else {
          window.__wt_p2p_file_cache = { [room.roomId || room.id]: localFile };
        }

        onClose();
        navigate(`/watch/${room.roomId || room.id}`);
        return;
      }
    } catch (err) {
      console.error("Failed to create room:", err);
      setError(err?.message || "Failed to create room. Please try again.");
      setLoading(false);
      setTunnelStatusText("");
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !loading && onClose()}>
      <div
        className="modal-content"
        style={{ maxWidth: 540 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <Globe size={18} color="var(--primary)" />
            <h3 style={{ fontSize: "1.0625rem", margin: 0 }}>Create Watch Party</h3>
          </div>
          <button className="btn-icon" onClick={onClose} disabled={loading}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleCreate}>
          <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
            {error && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: "var(--r-md)",
                  color: "#ef4444",
                  fontSize: "0.8125rem",
                  lineHeight: 1.4,
                }}
              >
                {error}
              </div>
            )}

            {/* Room Title */}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
              <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-1)" }}>
                Room Name
              </label>
              <input
                type="text"
                className="input"
                placeholder={selectedFile ? selectedFile.name.replace(/\.[^/.]+$/, "") : "e.g. Movie Night with Friends"}
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                autoFocus
                maxLength={60}
                disabled={loading}
              />
            </div>

            {/* Stream Mode Selector */}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className={`btn btn-sm ${inputType === 'tunnel' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                onClick={() => setInputType('tunnel')}
                disabled={loading}
              >
                <Globe size={14} />
                Cloudflare Tunnel
              </button>
              <button
                type="button"
                className={`btn btn-sm ${inputType === 'torrent' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                onClick={() => setInputType('torrent')}
                disabled={loading}
              >
                <Radio size={14} />
                BitTorrent
              </button>
              <button
                type="button"
                className={`btn btn-sm ${inputType === 'local' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5 }}
                onClick={() => setInputType('local')}
                disabled={loading}
              >
                <Zap size={14} />
                WebRTC P2P
              </button>
            </div>

            {/* CLOUDFLARE TUNNEL MODE */}
            {inputType === 'tunnel' && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                {isElectron ? (
                  <>
                    <input
                      type="file"
                      ref={fileInputRef}
                      accept=".mp4,.mkv,.webm,.mov,.avi"
                      style={{ display: "none" }}
                      onChange={handleBrowserFileSelected}
                    />

                    {selectedFile ? (
                      <div
                        style={{
                          padding: "var(--sp-4)",
                          background: "rgba(59, 130, 246, 0.08)",
                          border: "1px solid rgba(59, 130, 246, 0.3)",
                          borderRadius: "var(--r-md)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                          <Film size={22} color="#3b82f6" style={{ flexShrink: 0 }} />
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
                              {selectedFile.name}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>
                              {formatBytes(selectedFile.size)} • Automated Tunnel Ready
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={handlePickFile}
                          disabled={loading}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={handlePickFile}
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
                          Choose Local Video File to Stream
                        </p>
                        <p style={{ fontSize: "0.75rem", color: "var(--text-3)", margin: 0 }}>
                          Direct Play • Instant Seeking (HTTP 206) • Zero Cloud Storage Needed
                        </p>
                      </div>
                    )}

                    <div
                      style={{
                        padding: "10px 14px",
                        background: "rgba(16, 185, 129, 0.08)",
                        border: "1px solid rgba(16, 185, 129, 0.2)",
                        borderRadius: "var(--r-sm)",
                        fontSize: "0.78125rem",
                        color: "#10b981",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                        lineHeight: 1.45,
                      }}
                    >
                      <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>
                        <strong>1-Click Automated Streaming:</strong> Electron starts a local HTTP range server and connects a secure Cloudflare Quick Tunnel automatically. No port forwarding or setup required.
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-1)" }}>
                      Cloudflare Tunnel / Custom Video Stream URL
                    </label>
                    <input
                      type="url"
                      className="input"
                      placeholder="https://xyz.trycloudflare.com/video"
                      value={tunnelUrlInput}
                      onChange={(e) => setTunnelUrlInput(e.target.value)}
                      disabled={loading}
                    />
                    <div
                      style={{
                        padding: "10px 14px",
                        background: "rgba(59, 130, 246, 0.08)",
                        border: "1px solid rgba(59, 130, 246, 0.2)",
                        borderRadius: "var(--r-sm)",
                        fontSize: "0.78125rem",
                        color: "#3b82f6",
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                      }}
                    >
                      <Globe size={16} style={{ flexShrink: 0 }} />
                      <span>
                        Tip: Use the <strong>Watch Together Desktop App</strong> for 1-click automatic Cloudflare tunnel hosting from your files!
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TORRENT MODE */}
            {inputType === 'torrent' && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-1)" }}>
                  Torrent Magnet Link
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="magnet:?xt=urn:btih:..."
                  value={magnetLink}
                  onChange={(e) => setMagnetLink(e.target.value)}
                  disabled={loading}
                />
                <div
                  style={{
                    padding: "8px 12px",
                    background: "rgba(59, 130, 246, 0.08)",
                    border: "1px solid rgba(59, 130, 246, 0.2)",
                    borderRadius: "var(--r-sm)",
                    fontSize: "0.75rem",
                    color: "#3b82f6",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Zap size={14} style={{ flexShrink: 0 }} />
                  <span>
                    Direct BitTorrent swarm streaming with automatic modern fallback trackers.
                  </span>
                </div>
              </div>
            )}

            {/* WEBRTC P2P MODE */}
            {inputType === 'local' && (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                <label style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-1)" }}>
                  Choose Video for WebRTC Broadcast
                </label>

                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".mp4,.mkv,.webm,.mov,.avi"
                  style={{ display: "none" }}
                  onChange={handleBrowserFileSelected}
                />

                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: "var(--sp-4)",
                    background: "var(--bg)",
                    border: "1px dashed var(--border)",
                    borderRadius: "var(--r-md)",
                    textAlign: "center",
                    cursor: "pointer",
                  }}
                >
                  <Upload size={24} color="var(--primary)" style={{ margin: "0 auto var(--sp-2)" }} />
                  <p style={{ fontWeight: 600, color: "var(--text-1)", fontSize: "0.8125rem", margin: 0 }}>
                    {localFile ? localFile.name : "Select video file from device"}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "0.8125rem", color: "var(--text-2)", display: "flex", alignItems: "center", gap: 6 }}>
              {loading && tunnelStatusText && (
                <>
                  <Loader2 className="spinner" size={14} color="var(--primary)" />
                  <span>{tunnelStatusText}</span>
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={
                  loading ||
                  (inputType === "tunnel" ? (isElectron ? !selectedFile : !tunnelUrlInput.trim()) :
                   inputType === "torrent" ? !magnetLink.trim() : !localFile)
                }
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                {loading ? (
                  <>
                    <Loader2 className="spinner" size={16} /> Creating...
                  </>
                ) : (
                  <>
                    <Globe size={15} />
                    {inputType === "tunnel" ? "Launch Cloudflare Stream" :
                     inputType === "torrent" ? "Create Torrent Room" : "Broadcast WebRTC"}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
