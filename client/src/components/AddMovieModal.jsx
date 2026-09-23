import { useState, useEffect } from "react";
import { X, Film, Check, Plus, Trash2, Search, UploadCloud } from "lucide-react";
import { isMovieInUserLibrary, addMovieToUserLibrary, removeMovieFromUserLibrary } from "../utils/library.js";
import UploadZone from "./UploadZone.jsx";

export default function AddMovieModal({
  isOpen,
  onClose,
  movies = [],
  onMovieUploaded,
}) {
  const [search, setSearch] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filtered = movies.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.filename.toLowerCase().includes(search.toLowerCase())
  );

  function handleAdd(filename) {
    addMovieToUserLibrary(filename, movies);
  }

  function handleRemove(filename) {
    removeMovieFromUserLibrary(filename, movies);
  }

  function handleUploaded(updatedMovies, newFile) {
    onMovieUploaded?.(updatedMovies);
    if (newFile) {
      addMovieToUserLibrary(newFile, updatedMovies);
    }
    setShowUpload(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
            <Film size={18} />
            <h3 style={{ fontSize: "1rem", margin: 0 }}>Add Movies to Library</h3>
          </div>
          <button className="btn-icon" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
          <p style={{ fontSize: "0.8125rem", color: "var(--text-2)", margin: 0 }}>
            Choose which movies should appear in your personal library.
          </p>

          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search
                size={14}
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-3)",
                }}
              />
              <input
                type="text"
                className="input input-sm"
                placeholder="Search available movies..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ paddingLeft: 32, width: "100%" }}
              />
            </div>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowUpload((v) => !v)}
              style={{ whiteSpace: "nowrap" }}
            >
              <UploadCloud size={13} />
              {showUpload ? "Pick Movies" : "Upload File"}
            </button>
          </div>

          {showUpload ? (
            <div style={{ padding: "var(--sp-2)", background: "var(--bg)", borderRadius: "var(--r-md)" }}>
              <UploadZone onUploaded={handleUploaded} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "var(--sp-6)", textAlign: "center", color: "var(--text-3)", fontSize: "0.8125rem" }}>
              {search ? "No movies found matching your search." : "No movies available on server."}
            </div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              {filtered.map((m) => {
                const inLib = isMovieInUserLibrary(m.filename, movies);
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "var(--sp-3)",
                      background: inLib ? "rgba(255, 255, 255, 0.03)" : "var(--bg)",
                      border: `1px solid ${inLib ? "var(--border-hover)" : "var(--border)"}`,
                      borderRadius: "var(--r-md)",
                      gap: "var(--sp-3)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", minWidth: 0, flex: 1 }}>
                      <Film size={18} color={inLib ? "var(--text-1)" : "var(--text-3)"} style={{ flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: "0.8125rem",
                            fontWeight: inLib ? 600 : 400,
                            color: "var(--text-1)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={m.name}
                        >
                          {m.name}
                        </div>
                        <div style={{ fontSize: "0.7rem", color: "var(--text-3)" }}>
                          {m.sizeFormatted}
                        </div>
                      </div>
                    </div>

                    <div>
                      {inLib ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--success)",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontWeight: 500,
                            }}
                          >
                            <Check size={12} /> In Library
                          </span>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleRemove(m.filename)}
                            title="Remove from my library"
                            style={{ padding: "4px 8px", color: "var(--error)" }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleAdd(m.filename)}
                          style={{ padding: "4px 10px", fontSize: "0.75rem" }}
                        >
                          <Plus size={13} /> Add
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
          <button className="btn btn-primary btn-sm" onClick={onClose} style={{ marginLeft: "auto" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
