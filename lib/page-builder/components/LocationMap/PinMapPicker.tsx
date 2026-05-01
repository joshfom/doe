"use client";

import React, { useCallback, useMemo } from "react";
import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import type { LocationMapPin } from "./types";

function genId() {
  return `pin_${Math.random().toString(36).slice(2, 9)}`;
}

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

export type PinMapPickerValue = LocationMapPin[];

export type PinMapPickerProps = {
  value: PinMapPickerValue;
  onChange: (next: PinMapPickerValue) => void;
  readOnly?: boolean;
  apiKey: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
};

export function PinMapPicker({
  value,
  onChange,
  readOnly,
  apiKey,
  centerLat,
  centerLng,
  zoom,
}: PinMapPickerProps) {
  const pins = useMemo(() => value ?? [], [value]);

  const updatePin = useCallback(
    (id: string, patch: Partial<LocationMapPin>) => {
      onChange(pins.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    [pins, onChange],
  );

  const removePin = useCallback(
    (id: string) => {
      onChange(pins.filter((p) => p.id !== id));
    },
    [pins, onChange],
  );

  const addPin = useCallback(
    (lat: number, lng: number) => {
      const newPin: LocationMapPin = {
        id: genId(),
        label: `Pin ${pins.length + 1}`,
        lat,
        lng,
        iconImage: "",
        iconWidth: 32,
        iconHeight: 40,
        isHighlight: "no",
      };
      onChange([...pins, newPin]);
    },
    [pins, onChange],
  );

  if (!apiKey) {
    return (
      <div style={{ padding: 12, background: "#FAF5E8", border: "1px solid #E8DFC8", fontSize: 12, color: "#6B6B6B" }}>
        Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to enable the pin picker.
        You can still edit pin coordinates manually below once a key is configured.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: "#6B6B6B" }}>
        Click anywhere on the map to add a pin. Drag pins to reposition.
      </div>
      <div style={{ width: "100%", height: 280, border: "1px solid #E8E4DF" }}>
        <APIProvider apiKey={apiKey}>
          <Map
            defaultCenter={{ lat: centerLat, lng: centerLng }}
            defaultZoom={zoom}
            gestureHandling="greedy"
            disableDefaultUI={true}
            style={{ width: "100%", height: "100%" }}
          >
            {!readOnly ? <MapClickAdder onAdd={addPin} /> : null}
            {pins.map((pin) => (
              <Marker
                key={pin.id}
                position={{ lat: pin.lat, lng: pin.lng }}
                title={pin.label}
                draggable={!readOnly}
                onDragEnd={(ev: google.maps.MapMouseEvent) => {
                  const ll = ev.latLng;
                  if (!ll) return;
                  updatePin(pin.id, { lat: ll.lat(), lng: ll.lng() });
                }}
              />
            ))}
          </Map>
        </APIProvider>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
        {pins.length === 0 ? (
          <div style={{ fontSize: 12, color: "#6B6B6B", textAlign: "center", padding: 12 }}>
            No pins yet — click the map to add one.
          </div>
        ) : null}
        {pins.map((pin) => (
          <div
            key={pin.id}
            style={{
              display: "grid",
              gridTemplateColumns: "32px 1fr auto auto auto",
              alignItems: "center",
              gap: 6,
              padding: 6,
              border: "1px solid #E8E4DF",
              background: "#F9F7F5",
            }}
          >
            {pin.iconImage ? (
              <img
                src={pin.iconImage}
                alt=""
                style={{ width: 28, height: 28, objectFit: "contain", background: "#fff", border: "1px solid #E8E4DF" }}
              />
            ) : (
              <div style={{ width: 28, height: 28, background: "#fff", border: "1px dashed #D4CFC8" }} />
            )}
            <input
              type="text"
              value={pin.label}
              onChange={(e) => updatePin(pin.id, { label: e.target.value })}
              placeholder="Pin label"
              disabled={readOnly}
              style={{ minHeight: 28, border: "1px solid #E8E4DF", padding: "0 6px", fontSize: 12 }}
            />
            <button
              type="button"
              onClick={() => updatePin(pin.id, { isHighlight: pin.isHighlight === "yes" ? "no" : "yes" })}
              disabled={readOnly}
              title="Toggle highlight"
              style={{
                fontSize: 11,
                padding: "4px 8px",
                border: "1px solid #E8E4DF",
                background: pin.isHighlight === "yes" ? "#B8956B" : "#fff",
                color: pin.isHighlight === "yes" ? "#fff" : "#2C2C2C",
                cursor: "pointer",
              }}
            >
              ★
            </button>
            <button
              type="button"
              onClick={async () => {
                const url = await pickIconImage();
                if (url) updatePin(pin.id, { iconImage: url });
              }}
              disabled={readOnly}
              title="Upload icon image"
              style={{ fontSize: 11, padding: "4px 8px", border: "1px solid #E8E4DF", background: "#fff", cursor: "pointer" }}
            >
              Icon
            </button>
            <button
              type="button"
              onClick={() => removePin(pin.id)}
              disabled={readOnly}
              title="Remove pin"
              style={{ fontSize: 11, padding: "4px 8px", border: "1px solid #E8E4DF", background: "#fff", cursor: "pointer" }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
