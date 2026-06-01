"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";
import type {
  ContactLocationItem,
  ContactLocationsMapProps,
} from "./types";

function parseMapStyle(json: string): google.maps.MapTypeStyle[] | undefined {
  if (!json || !json.trim()) return undefined;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as google.maps.MapTypeStyle[]) : undefined;
  } catch {
    return undefined;
  }
}

function MapInner({
  locations,
  centerLat,
  centerLng,
  zoom,
  mapStyleJson,
  mapId,
  highlightedIndex,
  onPinClick,
  defaultPinIcon,
  defaultPinIconHighlight,
  pinIconWidth,
  pinIconHeight,
}: {
  locations: ContactLocationItem[];
  centerLat: number;
  centerLng: number;
  zoom: number;
  mapStyleJson: string;
  mapId?: string;
  highlightedIndex: number | null;
  onPinClick: (i: number) => void;
  defaultPinIcon?: string;
  defaultPinIconHighlight?: string;
  pinIconWidth: number;
  pinIconHeight: number;
}) {
  const map = useMap();
  const styles = useMemo(() => parseMapStyle(mapStyleJson), [mapStyleJson]);

  useEffect(() => {
    if (!map || highlightedIndex == null) return;
    const loc = locations[highlightedIndex];
    if (!loc) return;
    map.panTo({ lat: loc.lat, lng: loc.lng });
  }, [map, highlightedIndex, locations]);

  return (
    <Map
      defaultCenter={{ lat: centerLat, lng: centerLng }}
      defaultZoom={zoom}
      gestureHandling="cooperative"
      disableDefaultUI={false}
      styles={styles}
      mapId={mapId || undefined}
      style={{ width: "100%", height: "100%" }}
    >
      {locations.map((loc, i) => {
        const isHighlight =
          loc.isHighlight === "yes" || i === highlightedIndex;
        const iconUrl =
          (isHighlight ? loc.pinIconHighlight : loc.pinIcon) ||
          loc.pinIcon ||
          (isHighlight ? defaultPinIconHighlight : defaultPinIcon) ||
          defaultPinIcon ||
          "";
        const scale = isHighlight ? 1.25 : 1;
        const w = pinIconWidth * scale;
        const h = pinIconHeight * scale;
        return (
          <Marker
            key={i}
            position={{ lat: loc.lat, lng: loc.lng }}
            title={loc.title}
            onClick={() => onPinClick(i)}
            icon={
              iconUrl
                ? {
                    url: iconUrl,
                    scaledSize: new google.maps.Size(w, h),
                    anchor: new google.maps.Point(w / 2, h),
                  }
                : undefined
            }
            zIndex={isHighlight ? 1000 : undefined}
          />
        );
      })}
    </Map>
  );
}

function MissingApiKey() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 8,
        background: "linear-gradient(180deg,#F4ECDC 0%,#A9D5E5 100%)",
        color: "#2C2C2C",
        fontSize: 14,
        textAlign: "center",
        padding: 24,
      }}
    >
      <MapPin size={32} />
      <strong>Google Maps API key missing</strong>
      <span style={{ maxWidth: 480, fontSize: 13, color: "#4B4B4B" }}>
        Set <code>NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> in your <code>.env.local</code>
        {" "}or supply a per-component override in the editor.
      </span>
    </div>
  );
}

function CompassIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polygon points="16 8 10 10 8 16 14 14 16 8" />
    </svg>
  );
}

export function ContactLocationsMap(props: ContactLocationsMapProps) {
  const {
    containerMaxWidth,
    containerPaddingX,
    containerPaddingY,
    sectionBgColor,
    panelSide,
    panelWidth,
    panelBgColor,
    panelPaddingX,
    panelPaddingY,
    panelGap,
    dividerColor,
    showDividers,
    stackBreakpoint,

    panelOffsetTop,
    panelOffsetBottom,
    panelOffsetSide,
    panelBorderRadius,
    panelShadow,

    apiKeyOverride,
    centerLat,
    centerLng,
    zoom,
    mapHeight,
    mapStyleJson,
    mapId,

    titleColor,
    highlightTitleColor,
    badgeColor,
    addressColor,
    hoursColor,

    ctaBgColor,
    ctaTextColor,
    ctaBorderColor,
    ctaIconImage,

    defaultPinIcon,
    defaultPinIconHighlight,
    pinIconWidth,
    pinIconHeight,

    locations,
  } = props;

  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(() => {
    const i = (locations ?? []).findIndex((l) => l.isHighlight === "yes");
    return i >= 0 ? i : null;
  });

  const [isStacked, setIsStacked] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${stackBreakpoint || 900}px)`);
    const apply = () => setIsStacked(mq.matches);
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, [stackBreakpoint]);

  const handleCardClick = useCallback((i: number) => {
    setHighlightedIndex((prev) => (prev === i ? null : i));
  }, []);

  const handlePinClick = useCallback((i: number) => {
    setHighlightedIndex((prev) => (prev === i ? null : i));
  }, []);

  const apiKey =
    (apiKeyOverride && apiKeyOverride.trim()) ||
    (typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
      : undefined) ||
    "";

  const items = locations ?? [];
  const showDivider = showDividers === "yes";

  const panel = (
    <div
      style={{
        background: panelBgColor || "#FFFFFF",
        padding: `${panelPaddingY || "32px"} ${panelPaddingX || "32px"}`,
        width: isStacked ? "100%" : panelWidth || "420px",
        flexShrink: 0,
        boxSizing: "border-box",
        zIndex: 1,
        position: "relative",
        borderRadius: !isStacked && panelBorderRadius ? `${panelBorderRadius}px` : undefined,
        boxShadow:
          !isStacked && panelShadow === "yes"
            ? "0 12px 32px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04)"
            : undefined,
        maxHeight: !isStacked ? "100%" : undefined,
        overflowY: !isStacked ? "auto" : undefined,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: panelGap || "24px" }}>
        {items.map((loc, i) => {
          const isHi = loc.isHighlight === "yes" || i === highlightedIndex;
          const titleClr = isHi
            ? highlightTitleColor || "#11A6CC"
            : titleColor || "#2C2C2C";
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                onClick={() => handleCardClick(i)}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  cursor: "pointer",
                  color: "inherit",
                  font: "inherit",
                }}
                aria-pressed={i === highlightedIndex}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: 28,
                    lineHeight: 1.15,
                    fontWeight: 500,
                    color: titleClr,
                  }}
                >
                  {loc.title}
                </h3>
              </button>

              {loc.badge ? (
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: badgeColor || "#11A6CC",
                  }}
                >
                  {loc.badge}
                </div>
              ) : null}

              {loc.address ? (
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: addressColor || "#2C2C2C",
                    whiteSpace: "pre-line",
                  }}
                >
                  {loc.address}
                </div>
              ) : null}

              {loc.hours ? (
                <div
                  style={{
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: hoursColor || "#2C2C2C",
                    whiteSpace: "pre-line",
                  }}
                >
                  {loc.hours}
                </div>
              ) : null}

              {loc.ctaLabel && loc.ctaUrl ? (
                <a
                  href={loc.ctaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    alignSelf: "flex-start",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 18px",
                    marginTop: 4,
                    borderRadius: 999,
                    background: ctaBgColor || "#FFFFFF",
                    color: ctaTextColor || "#2C2C2C",
                    border: `1px solid ${ctaBorderColor || "#2C2C2C"}`,
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    textDecoration: "none",
                  }}
                >
                  {ctaIconImage ? (
                    <img
                      src={ctaIconImage}
                      alt=""
                      style={{ width: 16, height: 16, objectFit: "contain" }}
                    />
                  ) : (
                    <CompassIcon />
                  )}
                  <span>{loc.ctaLabel}</span>
                </a>
              ) : null}

              {showDivider && i < items.length - 1 ? (
                <hr
                  style={{
                    border: "none",
                    borderTop: `1px solid ${dividerColor || "#E8E4DF"}`,
                    margin: `${panelGap || "24px"} 0 0 0`,
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  const mapBox = (
    <div
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        height: isStacked ? "360px" : mapHeight || "100vh",
        background: "#EEE",
      }}
    >
      {apiKey ? (
        <APIProvider apiKey={apiKey}>
          <MapInner
            locations={items}
            centerLat={centerLat}
            centerLng={centerLng}
            zoom={zoom}
            mapStyleJson={mapStyleJson}
            mapId={mapId}
            highlightedIndex={highlightedIndex}
            onPinClick={handlePinClick}
            defaultPinIcon={defaultPinIcon}
            defaultPinIconHighlight={defaultPinIconHighlight}
            pinIconWidth={pinIconWidth || 32}
            pinIconHeight={pinIconHeight || 40}
          />
        </APIProvider>
      ) : (
        <MissingApiKey />
      )}
    </div>
  );

  // In side-by-side mode the panel overlays the map at the chosen side.
  // We use absolute positioning so the map fills the full width of the
  // section while the panel sits on top — matching the design.
  return (
    <div
      style={{
        width: "100%",
        background: sectionBgColor || "transparent",
        paddingTop: containerPaddingY || "0px",
        paddingBottom: containerPaddingY || "0px",
      }}
    >
      <div
        style={{
          maxWidth: containerMaxWidth || "100%",
          marginLeft: "auto",
          marginRight: "auto",
          paddingLeft: containerPaddingX || "0px",
          paddingRight: containerPaddingX || "0px",
        }}
      >
        {isStacked ? (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {panel}
            {mapBox}
          </div>
        ) : (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: mapHeight || "100vh",
            }}
          >
            <div style={{ position: "absolute", inset: 0 }}>{mapBox}</div>
            <div
              style={{
                position: "absolute",
                top: panelOffsetTop || "40px",
                bottom: panelOffsetBottom || "40px",
                [panelSide === "right" ? "right" : "left"]: panelOffsetSide || "40px",
                display: "flex",
                alignItems: "stretch",
                pointerEvents: "none",
              }}
            >
              <div style={{ pointerEvents: "auto", display: "flex" }}>{panel}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
