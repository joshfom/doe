export type LocationMapPin = {
  id: string;
  label: string;
  lat: number;
  lng: number;
  iconImage?: string;
  iconWidth?: number;
  iconHeight?: number;
  isHighlight?: "yes" | "no";
};

export type LocationMapCard = {
  pinId?: string;
  name: string;
  travelTime: string;
  image: string;
  isDark?: "yes" | "no";
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
};

export type LocationMapProps = {
  mapTitle?: string;
  titleColor?: string;
  apiKeyOverride?: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  mapHeight: string;
  mapStyleJson: string;
  mapId?: string;
  mapBorderRadius: number;
  pins: LocationMapPin[];
  cards: LocationMapCard[];

  // Container layout
  containerMaxWidth: string;   // e.g. "1200px" or "100%"
  containerPaddingX: string;   // horizontal padding (e.g. "24px")
  containerPaddingY: string;   // vertical padding (e.g. "48px")
  cardLayout: "boxed" | "fullWidth"; // boxed = constrained by containerMaxWidth

  // Cards
  cardColumns: number;
  cardGap: string;
  rowGap: string;
  cardImageHeight: string;     // e.g. "110px"
  cardBorderWidth: number;
  cardBorderColor: string;
  cardBorderRadius: number;
  cardPaddingX: string;
  cardPaddingY: string;
  spaceMapToCards: string;     // gap between map and cards
  spaceCardsToCta: string;     // gap between cards and CTA

  // CTA
  ctaLabel: string;
  ctaUrl: string;
  ctaBgColor: string;
  ctaTextColor: string;
  ctaBorderColor: string;
  ctaIconImage?: string;
};

export const DEFAULT_PIN_ICON_WIDTH = 32;
export const DEFAULT_PIN_ICON_HEIGHT = 40;

// ─── Contact Locations Map ───────────────────────────────────────────────────
// A side-by-side variant: stacked location address cards on one side, an
// interactive Google Map on the other. Each location carries its own lat/lng.

export type ContactLocationItem = {
  title: string;
  badge?: string;          // e.g. "COMING SOON" — rendered above the address
  address: string;         // multi-line string (newlines preserved)
  hours?: string;          // optional secondary line, e.g. "Monday - Sunday: 10:00 AM - 7:00 PM"
  lat: number;
  lng: number;
  ctaLabel?: string;       // e.g. "Get Direction" — shows button when set
  ctaUrl?: string;         // open in new tab
  isHighlight?: "yes" | "no"; // marks the active/featured location (different pin + title color)
  pinIcon?: string;        // optional custom marker image URL
  pinIconHighlight?: string; // optional override for highlight state
};

export type ContactLocationsMapProps = {
  // Layout
  containerMaxWidth: string;
  containerPaddingX: string;
  containerPaddingY: string;
  sectionBgColor: string;        // section behind everything
  panelSide: "left" | "right";   // which side the address panel sits
  panelWidth: string;            // CSS width for the panel (e.g. "420px")
  panelBgColor: string;
  panelPaddingX: string;
  panelPaddingY: string;
  panelGap: string;              // vertical gap between location entries
  dividerColor: string;          // hr between entries
  showDividers: "yes" | "no";
  stackBreakpoint: number;       // px below which the layout stacks (panel above map)

  // Map
  apiKeyOverride?: string;
  centerLat: number;
  centerLng: number;
  zoom: number;
  mapHeight: string;             // matches panel height in side-by-side mode
  mapStyleJson: string;
  mapId?: string;

  // Per-location styling
  titleColor: string;
  highlightTitleColor: string;   // color for `isHighlight: yes` titles
  badgeColor: string;
  addressColor: string;
  hoursColor: string;

  // Get-Direction button
  ctaBgColor: string;
  ctaTextColor: string;
  ctaBorderColor: string;
  ctaIconImage?: string;

  // Default pin icons (used when item-level overrides are empty)
  defaultPinIcon?: string;
  defaultPinIconHighlight?: string;
  pinIconWidth: number;
  pinIconHeight: number;

  locations: ContactLocationItem[];
};
