"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Upload, X, Check } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface MediaItem {
  id: string;
  filename: string;
  altText: string | null;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  storageUrl: string;
  storageBackend: string;
  createdAt: string;
}

export interface MediaLibraryPickerProps {
  /** Whether to allow selecting multiple images */
  multiple?: boolean;
  /** Called when user confirms selection */
  onSelect: (urls: string[]) => void;
  /** Called when dialog is closed without selection */
  onClose: () => void;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2147483646,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0, 0, 0, 0.6)",
  backdropFilter: "blur(2px)",
};

const DIALOG_STYLE: React.CSSProperties = {
  width: "90%",
  maxWidth: 1400,
  height: "90vh",
  background: "#fff",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 24px 80px rgba(0,0,0,0.3)",
};

const HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 24px",
  borderBottom: "1px solid #E8E4DF",
  background: "#F9F7F5",
};

const GRID_STYLE: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: 24,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: 12,
  alignContent: "start",
};

const FOOTER_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "12px 24px",
  borderTop: "1px solid #E8E4DF",
  background: "#F9F7F5",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function MediaLibraryPicker({ multiple = false, onSelect, onClose }: MediaLibraryPickerProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);

  // Fetch media library
  const fetchMedia = useCallback(async (searchQuery?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      const qs = params.toString();
      const res = await fetch(`/api/media${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        const allItems: MediaItem[] = json.data ?? [];
        // Filter to only image MIME types client-side
        setItems(allItems.filter((item) => item.mimeType.startsWith("image/")));
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMedia(search || undefined);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, fetchMedia]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const toggleSelect = (url: string) => {
    if (multiple) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(url)) next.delete(url);
        else next.add(url);
        return next;
      });
    } else {
      // Single select — immediately confirm
      onSelect([url]);
    }
  };

  const handleConfirm = () => {
    if (selected.size > 0) {
      onSelect(Array.from(selected));
    }
  };

  const handleUpload = async () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.onchange = async (ev) => {
      const files = (ev.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;
      setUploading(true);
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        try {
          await fetch("/api/media", { method: "POST", body: form, credentials: "include" });
        } catch {
          /* skip */
        }
      }
      setUploading(false);
      fetchMedia(search || undefined);
    };
    inp.click();
  };

  const dialog = (
    <div style={OVERLAY_STYLE} onClick={onClose}>
      <div
        style={DIALOG_STYLE}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Media Library"
      >
        {/* Header */}
        <div style={HEADER_STYLE}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#2C2C2C" }}>
            Media Library
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Search */}
            <div style={{ position: "relative" }}>
              <Search
                size={14}
                style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#6B6B6B" }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search images..."
                style={{
                  width: 220,
                  height: 34,
                  paddingLeft: 32,
                  paddingRight: 10,
                  border: "1px solid #E8E4DF",
                  fontSize: 12,
                  color: "#2C2C2C",
                  background: "#fff",
                }}
              />
            </div>
            {/* Upload button */}
            <button
              type="button"
              onClick={handleUpload}
              disabled={uploading}
              style={{
                height: 34,
                padding: "0 14px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#2C2C2C",
                color: "#fff",
                border: "none",
                fontSize: 12,
                cursor: uploading ? "wait" : "pointer",
              }}
            >
              <Upload size={14} />
              {uploading ? "Uploading..." : "Upload New"}
            </button>
            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "1px solid #E8E4DF",
                cursor: "pointer",
                color: "#6B6B6B",
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Grid */}
        <div style={GRID_STYLE}>
          {loading ? (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 40, color: "#6B6B6B", fontSize: 13 }}>
              Loading media...
            </div>
          ) : items.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: 40, color: "#6B6B6B", fontSize: 13 }}>
              No images found. Upload some to get started.
            </div>
          ) : (
            items.map((item) => {
              const isSelected = selected.has(item.storageUrl);
              return (
                <div
                  key={item.id}
                  onClick={() => toggleSelect(item.storageUrl)}
                  style={{
                    position: "relative",
                    cursor: "pointer",
                    border: isSelected ? "2px solid #2C2C2C" : "2px solid transparent",
                    background: "#F9F7F5",
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={item.storageUrl}
                    alt={item.altText || item.filename}
                    style={{
                      width: "100%",
                      height: 120,
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                  {/* Filename */}
                  <div
                    style={{
                      padding: "6px 8px",
                      fontSize: 10,
                      color: "#6B6B6B",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.filename}
                  </div>
                  {/* Selection indicator */}
                  {isSelected && (
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        width: 22,
                        height: 22,
                        background: "#2C2C2C",
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Check size={12} color="#fff" strokeWidth={2.5} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer (only for multi-select) */}
        {multiple && (
          <div style={FOOTER_STYLE}>
            <span style={{ fontSize: 12, color: "#6B6B6B" }}>
              {selected.size} image{selected.size !== 1 ? "s" : ""} selected
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  height: 34,
                  padding: "0 16px",
                  border: "1px solid #E8E4DF",
                  background: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                  color: "#6B6B6B",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={selected.size === 0}
                style={{
                  height: 34,
                  padding: "0 16px",
                  border: "none",
                  background: selected.size > 0 ? "#2C2C2C" : "#ccc",
                  color: "#fff",
                  fontSize: 12,
                  cursor: selected.size > 0 ? "pointer" : "default",
                }}
              >
                Add Selected
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
