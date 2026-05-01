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
