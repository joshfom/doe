'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Settings,
  Menu,
  PanelBottom,
  Shield,
  Link2,
  BarChart3,
  ListChecks,
  Target,
} from 'lucide-react';

const settingsNav = [
  { href: '/ora-panel/settings', label: 'General', icon: Settings, exact: true },
  { href: '/ora-panel/settings/menus', label: 'Menus', icon: Menu },
  { href: '/ora-panel/settings/footer', label: 'Footer', icon: PanelBottom },
  { href: '/ora-panel/settings/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/ora-panel/settings/event-vocabulary', label: 'Event Vocabulary', icon: ListChecks },
  { href: '/ora-panel/settings/conversion-goals', label: 'Conversion Goals', icon: Target },
  { href: '/ora-panel/settings/utm-builder', label: 'UTM Builder', icon: Link2 },
  { href: '/ora-panel/settings/audit', label: 'Audit Log', icon: Shield },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex gap-8">
      {/* Settings sidebar */}
      <aside className="w-48 shrink-0">
        <h2 className="mb-4 text-lg font-semibold text-ora-charcoal">Settings</h2>
        <nav className="space-y-1">
          {settingsNav.map(({ href, label, icon: Icon, exact }) => {
            const isActive = exact
              ? pathname === href
              : pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-ora-sand/60 font-medium text-ora-charcoal'
                    : 'text-ora-muted hover:bg-ora-sand/30 hover:text-ora-charcoal-light'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 stroke-[1.5]" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Settings content */}
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}
