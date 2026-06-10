import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { TouchRecord, AttributionData, ConsentState } from "./lib/analytics/types";

const ATTRIBUTION_COOKIE = "ora_attribution";
const CONSENT_COOKIE = "ora_consent";
const MAX_COOKIE_BYTES = 4000;
const MAX_TOUCHES = 20;
const DEFAULT_TTL_DAYS = 90;

const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

const CLICK_ID_PARAMS = [
  "gclid",
  "fbclid",
  "ttclid",
  "msclkid",
  "li_fat_id",
] as const;

/**
 * Determines if the referrer is from an external domain.
 */
function isExternalReferrer(referrer: string, requestHost: string): boolean {
  try {
    const referrerUrl = new URL(referrer);
    return referrerUrl.hostname !== requestHost;
  } catch {
    return false;
  }
}

/**
 * Reads and parses the consent cookie from the request.
 */
function readConsentState(request: NextRequest): ConsentState | null {
  const consentCookie = request.cookies.get(CONSENT_COOKIE);
  if (!consentCookie?.value) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(consentCookie.value)) as ConsentState;
    if (
      parsed &&
      parsed.necessary === true &&
      typeof parsed.analytics === "boolean" &&
      typeof parsed.marketing === "boolean" &&
      typeof parsed.timestamp === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Reads and parses the attribution cookie from the request.
 */
function readAttributionData(request: NextRequest): AttributionData | null {
  const cookie = request.cookies.get(ATTRIBUTION_COOKIE);
  if (!cookie?.value) return null;

  try {
    const parsed = JSON.parse(decodeURIComponent(cookie.value)) as AttributionData;
    if (parsed && parsed.first_touch && parsed.last_touch && Array.isArray(parsed.touches)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Truncates the touches array to fit within the byte limit.
 * Removes oldest entries first.
 */
function truncateToFit(data: AttributionData): string {
  let serialized = JSON.stringify(data);

  while (new TextEncoder().encode(serialized).length > MAX_COOKIE_BYTES && data.touches.length > 0) {
    data.touches.shift(); // Remove oldest touch
    serialized = JSON.stringify(data);
  }

  return serialized;
}

export function middleware(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const requestHost = request.headers.get("host")?.split(":")[0] ?? "";

  // Extract UTM parameters
  const utms: Partial<Record<(typeof UTM_PARAMS)[number], string>> = {};
  let hasUtm = false;
  for (const param of UTM_PARAMS) {
    const value = searchParams.get(param);
    if (value) {
      utms[param] = value;
      hasUtm = true;
    }
  }

  // Extract click IDs
  const clickIds: Partial<Record<(typeof CLICK_ID_PARAMS)[number], string>> = {};
  let hasClickId = false;
  for (const param of CLICK_ID_PARAMS) {
    const value = searchParams.get(param);
    if (value) {
      clickIds[param] = value;
      hasClickId = true;
    }
  }

  // Check for external referrer
  const refererHeader = request.headers.get("referer") ?? "";
  const hasExternalReferrer = refererHeader !== "" && isExternalReferrer(refererHeader, requestHost);

  // If no attribution signal found, pass through without modifying cookie
  if (!hasUtm && !hasClickId && !hasExternalReferrer) {
    return NextResponse.next();
  }

  // Build touch record
  const touch: TouchRecord = {
    ...utms,
    ...clickIds,
    referrer: hasExternalReferrer ? refererHeader : "",
    landing_path: request.nextUrl.pathname,
    timestamp: new Date().toISOString(),
  };

  // Auto-register UTM link if all required UTM params are present (fire-and-forget)
  if (hasUtm && utms.utm_source && utms.utm_medium && utms.utm_campaign) {
    try {
      const registrationPromise = import("@/lib/analytics/utm-auto-register").then(
        ({ autoRegisterUtmLink }) =>
          autoRegisterUtmLink({
            utmSource: utms.utm_source!,
            utmMedium: utms.utm_medium!,
            utmCampaign: utms.utm_campaign!,
            utmTerm: utms.utm_term ?? null,
            utmContent: utms.utm_content ?? null,
            landingPath: request.nextUrl.pathname,
          })
      );
      // Fire-and-forget: never block the response
      void registrationPromise.catch((err) => {
        console.error("[utm-auto-register] Failed to auto-register UTM link:", err);
      });
    } catch (err) {
      console.error("[utm-auto-register] Failed to initiate auto-registration:", err);
    }
  }

  // Read existing attribution data
  let attribution = readAttributionData(request);

  if (attribution) {
    // Update last_touch
    attribution.last_touch = touch;

    // Append to touches array
    attribution.touches.push(touch);

    // Cap at MAX_TOUCHES — drop oldest when full
    if (attribution.touches.length > MAX_TOUCHES) {
      attribution.touches = attribution.touches.slice(-MAX_TOUCHES);
    }
  } else {
    // Start fresh
    attribution = {
      first_touch: touch,
      last_touch: touch,
      touches: [touch],
    };
  }

  // Serialize and enforce byte limit
  const serialized = truncateToFit(attribution);

  // Read consent state
  const consent = readConsentState(request);
  const marketingAccepted = consent?.marketing === true;

  // Build response
  const response = NextResponse.next();

  // Determine cookie options based on consent
  const isProduction = process.env.NODE_ENV === "production";

  const cookieOptions: {
    path: string;
    sameSite: "lax";
    secure: boolean;
    httpOnly: boolean;
    maxAge?: number;
  } = {
    path: "/",
    sameSite: "lax",
    secure: isProduction,
    httpOnly: false,
  };

  // If marketing consent granted: set 90-day TTL
  // If marketing consent rejected or no consent given: session-scoped (no maxAge)
  if (marketingAccepted) {
    cookieOptions.maxAge = DEFAULT_TTL_DAYS * 24 * 60 * 60;
  }

  response.cookies.set(ATTRIBUTION_COOKIE, encodeURIComponent(serialized), cookieOptions);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /api/* (API routes)
     * - /_next/static/* (static files)
     * - /_next/image/* (image optimization)
     * - /favicon.ico
     * - /fonts/* (font files)
     */
    "/((?!api|_next/static|_next/image|favicon\\.ico|fonts).*)",
  ],
};
