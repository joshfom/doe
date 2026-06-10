"use client";

import React, { useCallback, useMemo, useState } from "react";
import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import type { ContactLocationItem } from "./types";

function uploadFile(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  return fetch("/api/media", { method: "POST", body: form, credentials: "include" })
    .then((res) => (res.ok ? res.json() : Promise.reject()))
    .then((data) => data.data?.storageUrl ?? data.data?.storage_url ?? "");
}

function pickIconImage(): Promise<string | null> {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async (ev) => {
      const f = (ev.target as HTMLInputElement).files?.[0];
      if (!f) return resolve(null);
      try {
        resolve(await uploadFile(f));
      } catch {
        resolve(null);
      }
    };
    inp.click();
  });
}

function MapClickAdder({ onAdd }: { onAdd: (lat: number, lng: number) => void }) {
  const map = useMap();
  React.useEffect(() => {
    if (!map) return;
    const listener = map.addListener("click", (ev: google.maps.MapMouseEvent) => {
      const ll = ev.latLng;
      if (!ll) return;
      onAdd(ll.lat(), ll.lng());
    });
    return () => listener.remove();
  }, [map, onAdd]);
  return null;
}

export type ContactLocationPickerValue = ContactLocationItem[];

export type ContactLocationPickerProps = {
  value: ContactLocationPickerValue;
  onChange: (next: ContactLocationPickerValue) => void;
  readOnly?: boolean;
  apiKey: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
};

const inputStyle: React.CSSProperties = {
  minHeight: 28,
  border: "1px solid #E8E4DF",
  padding: "4px 6px",
  fontSize: 12,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
};

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#6B6B6B",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 2,
};

const buttonStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "4px 8px",
  border: "1px solid #E8E4DF",
  background: "#fff",
  cursor: "pointer",
};

export function ContactLocationPicker({
  value,
  onChange,
  readOnly,
  apiKey,
  centerLat,
  centerLng,
  zoom,
}: ContactLocationPickerProps) {
  const items = useMemo(() => value ?? [], [value]);
  const [openIndex, setOpenIndex] = useState<number | null>(items.length > 0 ? 0 : null);

  const updateItem = useCallback(
    (index: number, patch: Partial<ContactLocationItem>) => {
      onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
    },
    [items, onChange],
  );

  const removeItem = useCallback(
    (index: number) => {
      onChange(items.filter((_, i) => i !== index));
      setOpenIndex((cur) => (cur === index ? null : cur != null && cur > index ? cur - 1 : cur));
    },
    [items, onChange],
  );

  const moveItem = useCallback(
    (from: number, dir: -1 | 1) => {
      const to = from + dir;
      if (to < 0 || to >= items.length) return;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onChange(next);
      setOpenIndex(to);
    },
    [items, onChange],
  );

  const addItem = useCallback(
    (lat: number, lng: number) => {
      const newItem: ContactLocationItem = {
        title: `Location ${items.length + 1}`,
        badge: "",
        address: "",
        hours: "",
        lat,
        lng,
        ctaLabel: "Get Direction",
        ctaUrl: "",
        isHighlight: items.length === 0 ? "yes" : "no",
        pinIcon: "",
        pinIconHighlight: "",
      };
      onChange([...items, newItem]);
      setOpenIndex(items.length);
    },
    [items, onChange],
  );

  if (!apiKey) {
    return (
      <div style={{ padding: 12, background: "#FAF5E8", border: "1px solid #E8DFC8", fontSize: 12, color: "#6B6B6B" }}>
        Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to enable the location picker.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: "#6B6B6B" }}>
        Click the map to add a location. Drag pins to reposition. Edit details below.
      </div>
      <div style={{ width: "100%", height: 240, border: "1px solid #E8E4DF" }}>
        <APIProvider apiKey={apiKey}>
          <Map
            defaultCenter={{ lat: centerLat, lng: centerLng }}
            defaultZoom={zoom}
            gestureHandling="greedy"
            disableDefaultUI={true}
            style={{ width: "100%", height: "100%" }}
          >
            {!readOnly ? <MapClickAdder onAdd={addItem} /> : null}
            {items.map((it, i) => (
              <Marker
                key={i}
                position={{ lat: it.lat, lng: it.lng }}
                title={it.title}
                draggable={!readOnly}
                onClick={() => setOpenIndex(i)}
                onDragEnd={(ev: google.maps.MapMouseEvent) => {
                  const ll = ev.latLng;
                  if (!ll) return;
                  updateItem(i, { lat: ll.lat(), lng: ll.lng() });
                }}
              />
            ))}
          </Map>
        </APIProvider>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: "#6B6B6B", textAlign: "center", padding: 12 }}>
            No locations yet — click the map to add one, or use the button below.
          </div>
        ) : null}
        {items.map((it, i) => {
          const isOpen = openIndex === i;
          return (
            <div key={i} style={{ border: "1px solid #E8E4DF", background: "#F9F7F5" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto auto auto auto",
                  alignItems: "center",
                  gap: 4,
                  padding: 6,
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(isOpen ? null : i)}
                  style={{
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#2C2C2C",
                    padding: "2px 4px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 10, color: "#6B6B6B" }}>{isOpen ? "▼" : "▶"}</span>
                  <span>
                    {i + 1}. {it.title || "(untitled)"}
                    {it.isHighlight === "yes" ? <span style={{ color: "#B8956B", marginLeft: 6 }}>★</span> : null}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => updateItem(i, { isHighlight: it.isHighlight === "yes" ? "no" : "yes" })}
                  disabled={readOnly}
                  title="Toggle highlight"
                  style={{
                    ...buttonStyle,
                    background: it.isHighlight === "yes" ? "#B8956B" : "#fff",
                    color: it.isHighlight === "yes" ? "#fff" : "#2C2C2C",
                  }}
                >
                  ★
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(i, -1)}
                  disabled={readOnly || i === 0}
                  title="Move up"
                  style={{ ...buttonStyle, opacity: i === 0 ? 0.4 : 1 }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => moveItem(i, 1)}
                  disabled={readOnly || i === items.length - 1}
                  title="Move down"
                  style={{ ...buttonStyle, opacity: i === items.length - 1 ? 0.4 : 1 }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  disabled={readOnly}
                  title="Remove location"
                  style={buttonStyle}
                >
                  ✕
                </button>
                <span />
              </div>

              {isOpen ? (
                <div style={{ padding: "8px 8px 10px 8px", display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #E8E4DF" }}>
                  <div>
                    <div style={labelStyle}>Title</div>
                    <input
                      type="text"
                      value={it.title}
                      onChange={(e) => updateItem(i, { title: e.target.value })}
                      disabled={readOnly}
                      style={inputStyle}
                      placeholder="ORA Main Office"
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>Badge</div>
                    <input
                      type="text"
                      value={it.badge ?? ""}
                      onChange={(e) => updateItem(i, { badge: e.target.value })}
                      disabled={readOnly}
                      style={inputStyle}
                      placeholder="COMING SOON (optional)"
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>Address (multi-line)</div>
                    <textarea
                      value={it.address}
                      onChange={(e) => updateItem(i, { address: e.target.value })}
                      disabled={readOnly}
                      style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontFamily: "inherit" }}
                      placeholder="Street, City, Country."
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>Hours / Secondary line</div>
                    <textarea
                      value={it.hours ?? ""}
                      onChange={(e) => updateItem(i, { hours: e.target.value })}
                      disabled={readOnly}
                      style={{ ...inputStyle, minHeight: 40, resize: "vertical", fontFamily: "inherit" }}
                      placeholder="Monday - Sunday: 10:00 AM - 7:00 PM"
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div>
                      <div style={labelStyle}>Latitude</div>
                      <input
                        type="number"
                        step="any"
                        value={it.lat}
                        onChange={(e) => updateItem(i, { lat: parseFloat(e.target.value) || 0 })}
                        disabled={readOnly}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <div style={labelStyle}>Longitude</div>
                      <input
                        type="number"
                        step="any"
                        value={it.lng}
                        onChange={(e) => updateItem(i, { lng: parseFloat(e.target.value) || 0 })}
                        disabled={readOnly}
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Button Label</div>
                    <input
                      type="text"
                      value={it.ctaLabel ?? ""}
                      onChange={(e) => updateItem(i, { ctaLabel: e.target.value })}
                      disabled={readOnly}
                      style={inputStyle}
                      placeholder="Get Direction"
                    />
                  </div>
                  <div>
                    <div style={labelStyle}>Button URL (Google Maps link)</div>
                    <input
                      type="text"
                      value={it.ctaUrl ?? ""}
                      onChange={(e) => updateItem(i, { ctaUrl: e.target.value })}
                      disabled={readOnly}
                      style={inputStyle}
                      placeholder="https://maps.google.com/?q=..."
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <div>
                      <div style={labelStyle}>Pin Icon</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {it.pinIcon ? (
                          <img src={it.pinIcon} alt="" style={{ width: 28, height: 28, objectFit: "contain", background: "#fff", border: "1px solid #E8E4DF" }} />
                        ) : (
                          <div style={{ width: 28, height: 28, background: "#fff", border: "1px dashed #D4CFC8" }} />
                        )}
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={async () => {
                            const url = await pickIconImage();
                            if (url) updateItem(i, { pinIcon: url });
                          }}
                          style={buttonStyle}
                        >
                          Upload
                        </button>
                        {it.pinIcon ? (
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => updateItem(i, { pinIcon: "" })}
                            style={buttonStyle}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div>
                      <div style={labelStyle}>Highlight Pin Icon</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {it.pinIconHighlight ? (
                          <img src={it.pinIconHighlight} alt="" style={{ width: 28, height: 28, objectFit: "contain", background: "#fff", border: "1px solid #E8E4DF" }} />
                        ) : (
                          <div style={{ width: 28, height: 28, background: "#fff", border: "1px dashed #D4CFC8" }} />
                        )}
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={async () => {
                            const url = await pickIconImage();
                            if (url) updateItem(i, { pinIconHighlight: url });
                          }}
                          style={buttonStyle}
                        >
                          Upload
                        </button>
                        {it.pinIconHighlight ? (
                          <button
                            type="button"
                            disabled={readOnly}
                            onClick={() => updateItem(i, { pinIconHighlight: "" })}
                            style={buttonStyle}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}

        {!readOnly ? (
          <button
            type="button"
            onClick={() => addItem(centerLat, centerLng)}
            style={{
              ...buttonStyle,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 600,
              marginTop: 4,
            }}
          >
            + Add Location
          </button>
        ) : null}
      </div>
    </div>
  );
}
