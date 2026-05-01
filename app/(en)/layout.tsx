import { fetchSiteSettings } from "@/lib/cms/utils/fetch-page";
import { SiteSettingsProvider } from "@/lib/cms/contexts/SiteSettingsContext";
import { NavigationBar } from "@/lib/cms/components/NavigationBar";
import { GlobalFooter } from "@/lib/cms/components/GlobalFooter";
import { ReactQueryProvider } from "@/lib/cms/components/ReactQueryProvider";
import { ChatWidget } from "@/lib/cms/components/ChatWidget";

export default async function EnLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await fetchSiteSettings();

  return (
    <div dir="ltr">
      <link rel="alternate" hrefLang="en" href="/" />
      <link rel="alternate" hrefLang="ar" href="/ar" />
      <SiteSettingsProvider settings={settings}>
        <ReactQueryProvider>
          <div className="min-h-screen flex flex-col">
            <NavigationBar />
            <main className="flex-1">{children}</main>
            <GlobalFooter locale="en" />
          </div>
          <ChatWidget locale="en" />
        </ReactQueryProvider>
      </SiteSettingsProvider>
    </div>
  );
}
