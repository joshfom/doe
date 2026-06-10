export interface TouchRecord {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  fbclid?: string;
  ttclid?: string;
  msclkid?: string;
  li_fat_id?: string;
  referrer: string;
  landing_path: string;
  timestamp: string; // ISO 8601
}

export interface AttributionData {
  first_touch: TouchRecord;
  last_touch: TouchRecord;
  touches: TouchRecord[];
}

export interface ConsentState {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  timestamp: string;
}

export interface TrackingConfig {
  trackAsEvent: boolean;
  eventName: string;
  eventProperties: Record<string, string>;
  elementId: string;
  conversionValue?: number;
  visibilityThreshold?: number;
}

export interface PageAnalyticsConfig {
  pageTemplate?: string;
  projectId?: string;
  unitType?: string;
  priceBand?: string;
  conversionGoal?: string;
  funnelSteps?: string[];
  experimentFlag?: string;
  surveyTrigger?: {
    type: "exit-intent" | "time-on-page" | "scroll-depth";
    value: number;
  };
  consentOverride?: "inherit" | "analytics-only" | "no-tracking";
}

export interface AnalyticsSettings {
  posthogKey: string;
  posthogHost: string;
  reverseProxyPath: string;
  clarityId?: string;
  ga4Id?: string;
  metaPixelId?: string;
  metaCapiToken?: string;
  googleAdsConversionId?: string;
  googleAdsConversionLabels?: string;
  googleEnhancedConversions?: boolean;
  tiktokPixelId?: string;
  tiktokEventsApiToken?: string;
  bingUetTagId?: string;
  cookieConsentMode: "strict" | "balanced" | "off";
  attributionWindowDays: number;
  piiRedaction: { maskInputs: boolean; maskText: boolean };
}
