"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Menu as MenuIcon, X, ChevronDown } from "lucide-react";
import type { MenuItemTree } from "@/lib/cms/types";
import type { LocaleConfig } from "@/lib/cms/config/locales";
import { isActiveUrl } from "@/lib/cms/utils/menu-tree";
import { DropdownPanel } from "./DropdownPanel";
import { MobileMenuOverlay } from "./MobileMenuOverlay";
import { RegisterInterestDialog } from "./RegisterInterestDialog";
import { LanguageSwitcher } from "./LanguageSwitcher";

interface NavigationBarClientProps {
  items: MenuItemTree[];
  ctaLabel: string;
  ctaUrl: string;
  enabledLocales: LocaleConfig[];
}

export function NavigationBarClient({
  items,
  ctaLabel,
  ctaUrl,
  enabledLocales,
}: NavigationBarClientProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCtaClick = useCallback(
    (e: React.MouseEvent) => {
      if (!ctaUrl || ctaUrl === "#" || ctaUrl === "#register-interest") {
        e.preventDefault();
        setRegisterOpen(true);
      }
    },
    [ctaUrl]
  );

  const handleMouseEnter = useCallback((itemId: string) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpenDropdown(itemId);
  }, []);

  const handleMouseLeave = useCallback(() => {
    closeTimerRef.current = setTimeout(() => {
      setOpenDropdown(null);
    }, 150);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  return (
    <>
      <header
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          margin: 0,
          padding: 0,
          zIndex: 50,
        }}
      >
        <nav className="flex h-16 items-center justify-between bg-ora-charcoal/60 backdrop-blur-md px-6 lg:px-10" style={{ fontFamily: "var(--font-poppins), sans-serif" }}>
          {/* Logo */}
          <Link href="/" className="shrink-0">
            <Image
              src="/site-logo.svg"
              alt="Site logo"
              width={120}
              height={36}
              className="h-9 w-auto brightness-0 invert"
              unoptimized
            />
          </Link>

          {/* Desktop menu items */}
          <ul className="hidden md:flex items-center gap-0.5">
            {items.map((item) => {
              const active = isActiveUrl(item.url, pathname);
              const hasDropdown =
                item.itemType === "dropdown" && item.children.length > 0;
              const isOpen = openDropdown === item.id;

              return (
                <li
                  key={item.id}
                  className="relative"
                  onMouseEnter={() =>
                    hasDropdown ? handleMouseEnter(item.id) : undefined
                  }
                  onMouseLeave={hasDropdown ? handleMouseLeave : undefined}
                >
                  <Link
                    href={item.url}
                    className={`relative flex items-center gap-1.5 px-5 py-2 text-[13px] uppercase tracking-widest whitespace-nowrap transition-all duration-200 ${
                      active
                        ? "font-bold text-white"
                        : "font-normal text-white/80 hover:font-bold hover:text-white"
                    }`}
                  >
                    <span className="nav-item-label" data-text={item.label}>{item.label}</span>
                    {hasDropdown && (
                      <ChevronDown
                        className={`h-3.5 w-3.5 stroke-[1.5] transition-transform duration-200 ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    )}
                  </Link>

                  {hasDropdown && isOpen && (
                    <div
                      onMouseEnter={() => handleMouseEnter(item.id)}
                      onMouseLeave={handleMouseLeave}
                    >
                      <DropdownPanel
                        items={item.children}
                        onClose={() => setOpenDropdown(null)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Right side: Language switcher + CTA + hamburger */}
          <div className="flex items-center gap-3">
            <LanguageSwitcher locales={enabledLocales} />

            {ctaLabel && (
              <Link
                href={ctaUrl || "#"}
                onClick={handleCtaClick}
                className="hidden sm:inline-flex h-10 items-center px-7 rounded-full text-[13px] uppercase tracking-widest border border-white/60 text-white font-normal hover:bg-white hover:text-ora-charcoal hover:border-white transition-all duration-200"
              >
                {ctaLabel}
              </Link>
            )}

            <button
              type="button"
              className="inline-flex md:hidden h-10 w-10 items-center justify-center text-white hover:bg-white/10 transition-colors"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileOpen((v) => !v)}
            >
              {mobileOpen ? (
                <X className="h-5 w-5 stroke-1" />
              ) : (
                <MenuIcon className="h-5 w-5 stroke-1" />
              )}
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile overlay */}
      <MobileMenuOverlay
        items={items}
        ctaLabel={ctaLabel}
        ctaUrl={ctaUrl}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onCtaClick={handleCtaClick}
        enabledLocales={enabledLocales}
      />

      {/* Register Interest dialog */}
      <RegisterInterestDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
      />
    </>
  );
}
