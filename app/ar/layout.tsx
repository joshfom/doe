import { Noto_Sans_Arabic } from "next/font/google";
import { fetchSiteSettings } from "@/lib/cms/utils/fetch-page";
import { SiteSettingsProvider } from "@/lib/cms/contexts/SiteSettingsContext";

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

  return (
    <div dir="rtl" className={notoSansArabic.variable} style={{ fontFamily: "var(--font-arabic), var(--font-sans, system-ui, sans-serif)" }}>
      <link rel="alternate" hrefLang="en" href="/" />
      <link rel="alternate" hrefLang="ar" href="/ar" />
      <SiteSettingsProvider settings={settings}>
        {children}
      </SiteSettingsProvider>
    </div>
  );
}
