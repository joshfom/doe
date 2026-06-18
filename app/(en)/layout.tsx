import { fetchSiteSettings } from "@/lib/cms/utils/fetch-page";
import { SiteSettingsProvider } from "@/lib/cms/contexts/SiteSettingsContext";
import { NavigationBar } from "@/lib/cms/components/NavigationBar";
import { GlobalFooter } from "@/lib/cms/components/GlobalFooter";
import { ReactQueryProvider } from "@/lib/cms/components/ReactQueryProvider";
import { ChatWidget } from "@/lib/cms/components/ChatWidget";
import { CallWidget } from "@/lib/cms/components/call-widget";
import { PostHogProvider } from "@/lib/analytics/posthog-provider";
import { ClarityScript } from "@/lib/analytics/clarity";
import { ConsentBanner } from "@/lib/analytics/consent-banner";
import { AutoFormTracker } from "@/lib/analytics/form-tracker";

export default async function EnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await fetchSiteSettings();

  // Operational analytics settings — toggled by admins without redeploy.
  // Provider keys (PostHog, Clarity, GA4) come from .env directly.
  const piiRedaction = {
    maskInputs: settings.analytics_pii_mask_inputs !== "false", // default true
    maskText: settings.analytics_pii_mask_text !== "false", // default true
  };
  const consentMode = (settings.analytics_consent_mode as "strict" | "balanced" | "off") ?? "strict";

  // Public voice call widget — opt-in, toggled by admins without redeploy.
  // Default OFF until the container voice workers are live (S6 R7.4).
  const voiceEnabled = settings.voice_call_widget_enabled === "true";

  return (
    <div dir="ltr">
      <link rel="alternate" hrefLang="en" href="/" />
      <link rel="alternate" hrefLang="ar" href="/ar" />
      <PostHogProvider piiRedaction={piiRedaction} consentMode={consentMode}>
        <SiteSettingsProvider settings={settings}>
          <ReactQueryProvider>
            <div className="min-h-screen flex flex-col">
              <NavigationBar locale="en" />
              <main className="flex-1">
                <AutoFormTracker>{children}</AutoFormTracker>
              </main>
              <GlobalFooter locale="en" />
            </div>
            <ChatWidget locale="en" />
            {voiceEnabled && <CallWidget variant="floating" locale="en" />}
          </ReactQueryProvider>
        </SiteSettingsProvider>
        <ClarityScript />
        <ConsentBanner consentMode={consentMode} locale="en" />
      </PostHogProvider>
    </div>
  );
}
