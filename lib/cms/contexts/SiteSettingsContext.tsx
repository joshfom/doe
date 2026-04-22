"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface SiteSettings {
  [key: string]: string;
}

const SiteSettingsContext = createContext<SiteSettings>({});

export function SiteSettingsProvider({
  settings,
  children,
}: {
  settings: SiteSettings;
  children: ReactNode;
}) {
  return (
    <SiteSettingsContext.Provider value={settings}>
      {children}
    </SiteSettingsContext.Provider>
  );
}

export function useSiteSettings(): SiteSettings {
  return useContext(SiteSettingsContext);
}
