import { Noto_Sans_Arabic } from "next/font/google";
import { fetchSiteSettings } from "@/lib/cms/utils/fetch-page";
import { SiteSettingsProvider } from "@/lib/cms/contexts/SiteSettingsContext";
import { NavigationBar } from "@/lib/cms/components/NavigationBar";
import { GlobalFooter } from "@/lib/cms/components/GlobalFooter";
import { ReactQueryProvider } from "@/lib/cms/components/ReactQueryProvider";
import { ChatWidget } from "@/lib/cms/components/ChatWidget";
import { PostHogProvider } from "@/lib/analytics/posthog-provider";
import { ClarityScript } from "@/lib/analytics/clarity";
import { ConsentBanner } from "@/lib/analytics/consent-banner";
import { AutoFormTracker } from "@/lib/analytics/form-tracker";

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  display: "swap",
});

export default async function ArLayout({
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

  return (
    <div dir="rtl" className={notoSansArabic.variable} style={{ fontFamily: "var(--font-arabic), var(--font-sans, system-ui, sans-serif)" }}>
      <link rel="alternate" hrefLang="en" href="/" />
      <link rel="alternate" hrefLang="ar" href="/ar" />
      <PostHogProvider piiRedaction={piiRedaction} consentMode={consentMode}>
        <SiteSettingsProvider settings={settings}>
          <ReactQueryProvider>
            <div className="min-h-screen flex flex-col">
              <NavigationBar />
              <main className="flex-1">
                <AutoFormTracker>{children}</AutoFormTracker>
              </main>
              <GlobalFooter locale="ar" />
            </div>
            <ChatWidget locale="ar" />
          </ReactQueryProvider>
        </SiteSettingsProvider>
        <ClarityScript />
        <ConsentBanner consentMode={consentMode} locale="ar" />
      </PostHogProvider>
    </div>
  );
}
