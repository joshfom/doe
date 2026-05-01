"use client";

/**
 * OraColorPicker — ORA palette presets, recents, hex input, optional alpha.
 *
 * Recent colors persist in `localStorage` under `ora.colorPicker.recents`.
 * Eyedropper uses the EyeDropper API where available with graceful fallback.
 */

import React from "react";
import { ORA_PALETTE_PRESETS, ORA_THEME } from "../tokens";

const RECENTS_KEY = "ora.colorPicker.recents";
const MAX_RECENTS = 8;

const HEX_RE = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function normalizeHex(input: string): string | null {
  const trimmed = input.trim();
  const m = trimmed.match(HEX_RE);
  if (!m) return null;
  const value = m[1].toUpperCase();
  return `#${value}`;
}

function readRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

function writeRecents(list: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}

function pushRecent(prev: string[], color: string): string[] {
  const without = prev.filter((c) => c.toUpperCase() !== color.toUpperCase());
  return [color, ...without].slice(0, MAX_RECENTS);
}

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>;
}

function getEyeDropper(): EyeDropperLike | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as unknown as { EyeDropper?: new () => EyeDropperLike }).EyeDropper;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

export interface OraColorPickerProps {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  allowAlpha?: boolean;
  presets?: readonly string[];
  /** Disable the eyedropper button even when supported (testing). */
  disableEyedropper?: boolean;
}

export function OraColorPicker({
  label,
  value,
  onChange,
  allowAlpha = false,
  presets = ORA_PALETTE_PRESETS,
  disableEyedropper,
}: OraColorPickerProps) {
  const [recents, setRecents] = React.useState<string[]>(() => readRecents());
  const [hexDraft, setHexDraft] = React.useState<string>(value);

  React.useEffect(() => {
    setHexDraft(value);
  }, [value]);

  const commit = React.useCallback(
    (next: string) => {
      onChange(next);
      const updated = pushRecent(recents, next);
      setRecents(updated);
      writeRecents(updated);
    },
    [onChange, recents],
  );

  const handlePresetClick = (color: string) => {
    commit(color);
  };

  const handleHexBlur = () => {
    const normalized = normalizeHex(hexDraft);
    if (normalized) {
      commit(normalized);
    } else {
      setHexDraft(value);
    }
  };

  const alpha = React.useMemo(() => {
    if (!allowAlpha) return 1;
    if (value.length !== 9) return 1;
    const a = parseInt(value.slice(7, 9), 16);
    return Number.isFinite(a) ? a / 255 : 1;
  }, [value, allowAlpha]);

  const handleAlpha = (a: number) => {
    if (!allowAlpha) return;
    const base = value.slice(0, 7);
    const aHex = Math.round(a * 255).toString(16).padStart(2, "0").toUpperCase();
    commit(`${base}${aHex}`);
  };

  const eyeDropper = !disableEyedropper ? getEyeDropper() : null;

  const handleEyeDropper = async () => {
    if (!eyeDropper) return;
    try {
      const result = await eyeDropper.open();
      const norm = normalizeHex(result.sRGBHex);
      if (norm) commit(norm);
    } catch {
      /* user cancelled */
    }
  };

  const isPreset = React.useCallback(
    (color: string) => color.toUpperCase() === value.toUpperCase().slice(0, 7),
    [value],
  );

  return (
    <div style={{ marginBottom: 12 }}>
      {label ? (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: ORA_THEME.muted,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 6,
          }}
        >
          {label}
        </div>
      ) : null}

      <div role="group" aria-label="ORA color presets" style={swatchRowStyle}>
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Select ${color}`}
            aria-pressed={isPreset(color)}
            onClick={() => handlePresetClick(color)}
            data-active={isPreset(color) || undefined}
            style={{
              ...swatchStyle,
              background: color,
              outline: isPreset(color) ? `2px solid ${ORA_THEME.gold}` : undefined,
              outlineOffset: isPreset(color) ? 1 : undefined,
            }}
          />
        ))}
      </div>

      {recents.length > 0 ? (
        <>
          <div style={subLabelStyle}>Recent</div>
          <div role="group" aria-label="Recent colors" style={swatchRowStyle}>
            {recents.map((color) => (
              <button
                key={`recent-${color}`}
                type="button"
                aria-label={`Select recent ${color}`}
                onClick={() => handlePresetClick(color)}
                style={{ ...swatchStyle, background: color }}
              />
            ))}
          </div>
        </>
      ) : null}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input
          type="text"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={handleHexBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Hex value"
          spellCheck={false}
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: 12,
            fontFamily: "monospace",
            border: `1px solid ${ORA_THEME.border}`,
            background: ORA_THEME.white,
            color: ORA_THEME.charcoal,
            borderRadius: 0,
          }}
        />
        {eyeDropper ? (
          <button
            type="button"
            aria-label="Pick color from screen"
            onClick={handleEyeDropper}
            style={{
              padding: "6px 8px",
              fontSize: 12,
              border: `1px solid ${ORA_THEME.border}`,
              background: ORA_THEME.white,
              cursor: "pointer",
              borderRadius: 0,
            }}
          >
            ⊙
          </button>
        ) : null}
      </div>

      {allowAlpha ? (
        <div style={{ marginTop: 8 }}>
          <div style={subLabelStyle}>Opacity</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={alpha}
            onChange={(e) => handleAlpha(Number(e.target.value))}
            aria-label="Opacity"
            style={{ width: "100%" }}
          />
        </div>
      ) : null}
    </div>
  );
}

const swatchRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  gap: 4,
  marginBottom: 6,
};

const swatchStyle: React.CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  border: `1px solid ${ORA_THEME.border}`,
  cursor: "pointer",
  padding: 0,
};

const subLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: ORA_THEME.muted,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 4,
  marginTop: 4,
};
