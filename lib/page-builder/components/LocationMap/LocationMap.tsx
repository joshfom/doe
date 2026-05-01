"use client";

import React, { useCallback, useMemo, useState } from "react";
import { APIProvider, Map, Marker, useMap } from "@vis.gl/react-google-maps";
import { MapPin } from "lucide-react";
import type { LocationMapCard, LocationMapPin, LocationMapProps } from "./types";
import { DEFAULT_PIN_ICON_HEIGHT, DEFAULT_PIN_ICON_WIDTH } from "./types";

// Parse the user-supplied map style JSON safely.
function parseMapStyle(json: string): google.maps.MapTypeStyle[] | undefined {
  if (!json || !json.trim()) return undefined;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as google.maps.MapTypeStyle[]) : undefined;
  } catch {
    return undefined;
  }
}

// Inner map component — has access to the map instance via useMap().
function MapInner({
  pins,
  centerLat,
  centerLng,
  zoom,
  mapStyleJson,
  mapId,
  highlightedPinId,
  onPinClick,
}: {
  pins: LocationMapPin[];
  centerLat: number;
  centerLng: number;
  zoom: number;
  mapStyleJson: string;
  mapId?: string;
  highlightedPinId: string | null;
  onPinClick: (id: string) => void;
}) {
  const map = useMap();
  const styles = useMemo(() => parseMapStyle(mapStyleJson), [mapStyleJson]);

  // Pan to the highlighted pin whenever it changes.
  React.useEffect(() => {
    if (!map || !highlightedPinId) return;
    const pin = pins.find((p) => p.id === highlightedPinId);
    if (!pin) return;
    map.panTo({ lat: pin.lat, lng: pin.lng });
  }, [map, highlightedPinId, pins]);

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
      {pins.map((pin) => {
        const isHighlight = pin.isHighlight === "yes" || pin.id === highlightedPinId;
        const baseW = pin.iconWidth || DEFAULT_PIN_ICON_WIDTH;
        const baseH = pin.iconHeight || DEFAULT_PIN_ICON_HEIGHT;
        const scale = isHighlight ? 1.6 : 1;
        const iconUrl = pin.iconImage?.trim();
        return (
          <Marker
            key={pin.id}
            position={{ lat: pin.lat, lng: pin.lng }}
            title={pin.label}
            onClick={() => onPinClick(pin.id)}
            icon={
              iconUrl
                ? {
                    url: iconUrl,
                    scaledSize: new google.maps.Size(baseW * scale, baseH * scale),
                    anchor: new google.maps.Point((baseW * scale) / 2, baseH * scale),
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

function CardsGrid({
  cards,
  columns,
  gap,
  rowGap,
  imageHeight,
  borderWidth,
  borderColor,
  borderRadius,
  paddingX,
  paddingY,
  highlightedPinId,
  onCardClick,
}: {
  cards: LocationMapCard[];
  columns: number;
  gap: string;
  rowGap: string;
  imageHeight: string;
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
  paddingX: string;
  paddingY: string;
  highlightedPinId: string | null;
  onCardClick: (pinId?: string) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        columnGap: gap,
        rowGap,
      }}
    >
      {cards.map((card, i) => {
        const isDark = card.isDark === "yes";
        const isSelected = !!card.pinId && card.pinId === highlightedPinId;
        const bg = card.bgColor || (isDark ? "#2C2C2C" : "#FFFFFF");
        const fg = card.textColor || (isDark ? "#FFFFFF" : "#2C2C2C");
        const border = card.borderColor || borderColor || (isDark ? "transparent" : "#E8E4DF");
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCardClick(card.pinId)}
            style={{
              display: "flex",
              flexDirection: "column",
              padding: 0,
              background: bg,
              color: fg,
              border: `${borderWidth}px solid ${isSelected ? "#B8956B" : border}`,
              borderRadius: borderRadius ? `${borderRadius}px` : undefined,
              cursor: card.pinId ? "pointer" : "default",
              textAlign: "left",
              transition: "border-color .2s ease",
              overflow: "hidden",
            }}
            aria-pressed={isSelected}
          >
            <div style={{ padding: `${paddingY} ${paddingX} ${paddingY === "0px" ? "0px" : "12px"} ${paddingX}` }}>
              <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{card.name}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, opacity: 0.85 }}>
                <ClockIcon />
                <span>{card.travelTime}</span>
              </div>
            </div>
            {card.image ? (
              <img
                src={card.image}
                alt={card.name}
                style={{ width: "100%", height: imageHeight || "110px", objectFit: "cover", display: "block" }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

export function LocationMap(props: LocationMapProps) {
  const {
    mapTitle,
    titleColor,
    apiKeyOverride,
    centerLat,
    centerLng,
    zoom,
    mapHeight,
    mapStyleJson,
    mapId,
    mapBorderRadius,
    pins,
    cards,
    containerMaxWidth,
    containerPaddingX,
    containerPaddingY,
    cardLayout,
    cardColumns,
    cardGap,
    rowGap,
    cardImageHeight,
    cardBorderWidth,
    cardBorderColor,
    cardBorderRadius,
    cardPaddingX,
    cardPaddingY,
    spaceMapToCards,
    spaceCardsToCta,
    ctaLabel,
    ctaUrl,
    ctaBgColor,
    ctaTextColor,
    ctaBorderColor,
    ctaIconImage,
  } = props;

  const [highlightedPinId, setHighlightedPinId] = useState<string | null>(null);

  const handleCardClick = useCallback((pinId?: string) => {
    if (!pinId) return;
    setHighlightedPinId((prev) => (prev === pinId ? null : pinId));
  }, []);

  const handlePinClick = useCallback((id: string) => {
    setHighlightedPinId((prev) => (prev === id ? null : id));
  }, []);

  const apiKey =
    (apiKeyOverride && apiKeyOverride.trim()) ||
    (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY : undefined) ||
    "";

  const isFullWidth = cardLayout === "fullWidth";
  const innerMaxWidth = containerMaxWidth || "1200px";
  const padX = containerPaddingX || "24px";
  const padY = containerPaddingY || "48px";

  // The map and cards-CTA group; in "fullWidth" mode cards span the section width
  // while the map+title still respect the constrained width.
  const constrainedStyle: React.CSSProperties = {
    maxWidth: innerMaxWidth,
    marginLeft: "auto",
    marginRight: "auto",
    paddingLeft: padX,
    paddingRight: padX,
  };

  return (
    <div style={{ width: "100%", paddingTop: padY, paddingBottom: padY }}>
      {mapTitle ? (
        <div style={constrainedStyle}>
          <h2
            style={{
              textAlign: "center",
              fontSize: 56,
              fontWeight: 400,
              margin: "0 0 24px 0",
              color: titleColor || "#2C2C2C",
            }}
          >
            {mapTitle}
          </h2>
        </div>
      ) : null}

      <div style={constrainedStyle}>
        <div
          style={{
            width: "100%",
            height: mapHeight || "440px",
            borderRadius: mapBorderRadius ? `${mapBorderRadius}px` : undefined,
            overflow: "hidden",
            background: "#EEE",
          }}
        >
          {apiKey ? (
            <APIProvider apiKey={apiKey}>
              <MapInner
                pins={pins ?? []}
                centerLat={centerLat}
                centerLng={centerLng}
                zoom={zoom}
                mapStyleJson={mapStyleJson}
                mapId={mapId}
                highlightedPinId={highlightedPinId}
                onPinClick={handlePinClick}
              />
            </APIProvider>
          ) : (
            <MissingApiKey />
          )}
        </div>
      </div>

      {cards && cards.length > 0 ? (
        <div style={isFullWidth ? { paddingLeft: padX, paddingRight: padX, marginTop: spaceMapToCards || "24px" } : { ...constrainedStyle, marginTop: spaceMapToCards || "24px" }}>
          <CardsGrid
            cards={cards}
            columns={cardColumns || 5}
            gap={cardGap || "12px"}
            rowGap={rowGap || "12px"}
            imageHeight={cardImageHeight || "110px"}
            borderWidth={cardBorderWidth ?? 1}
            borderColor={cardBorderColor || "#E8E4DF"}
            borderRadius={cardBorderRadius ?? 0}
            paddingX={cardPaddingX || "16px"}
            paddingY={cardPaddingY || "16px"}
            highlightedPinId={highlightedPinId}
            onCardClick={handleCardClick}
          />
        </div>
      ) : null}

      {ctaUrl ? (
        <div style={{ ...constrainedStyle, display: "flex", justifyContent: "center", marginTop: spaceCardsToCta || "32px" }}>
          <a
            href={ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 28px",
              borderRadius: 999,
              background: ctaBgColor || "#FFFFFF",
              color: ctaTextColor || "#2C2C2C",
              border: `1px solid ${ctaBorderColor || "#2C2C2C"}`,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            {ctaIconImage ? (
              <img src={ctaIconImage} alt="" style={{ width: 18, height: 18, objectFit: "contain" }} />
            ) : (
              <MapPin size={16} />
            )}
            <span>{ctaLabel || "See on Google Maps"}</span>
          </a>
        </div>
      ) : null}
    </div>
  );
}
