'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  LayoutDashboard,
  FileText,
  Image as ImageIcon,
  Inbox,
  Settings,
  Shield,
  LogOut,
  PanelLeftOpen,
  PanelLeftClose,
} from 'lucide-react';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || '';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const navItems = [
  { href: '/ora-panel', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/ora-panel/pages', label: 'Pages', icon: FileText },
  { href: '/ora-panel/media', label: 'Media', icon: ImageIcon },
  { href: '/ora-panel/submissions', label: 'Submissions', icon: Inbox },
  { href: '/ora-panel/settings', label: 'Settings', icon: Settings },
  { href: '/ora-panel/audit', label: 'Audit', icon: Shield },
];

export default function OraPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  const isLoginPage = pathname === '/ora-panel/login' || pathname === '/ora-panel/register';

  useEffect(() => {
    if (isLoginPage) {
      setAuthed(true);
      return;
    }

    fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' })
      .then((res) => {
        if (res.ok) {
          setAuthed(true);
        } else {
          router.replace('/ora-panel/login');
        }
      })
      .catch(() => {
        router.replace('/ora-panel/login');
      });
  }, [isLoginPage, router]);

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      router.replace('/ora-panel/login');
    }
  };

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ora-cream-light">
        <p className="text-sm text-ora-muted">Loading…</p>
      </div>
    );
  }

  if (isLoginPage) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  const sidebarWidth = collapsed ? 'w-16' : 'w-56';
  const mainMargin = collapsed ? 'ml-16' : 'ml-56';

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-30 ${sidebarWidth} border-r border-ora-sand bg-ora-white transition-all duration-200`}>
          <div className="flex h-full flex-col">
            {/* Logo + toggle */}
            <div className="flex items-center justify-between border-b border-ora-sand px-3 py-4">
              {!collapsed && (
                <Image
                  src="/logo.svg"
                  alt="ORA"
                  width={60}
                  height={22}
                  className="ml-1 opacity-80"
                />
              )}
              <button
                onClick={() => setCollapsed(!collapsed)}
                className={`flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-light transition-colors ${collapsed ? 'mx-auto' : ''}`}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4 stroke-1" />
                ) : (
                  <PanelLeftClose className="h-4 w-4 stroke-1" />
                )}
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 px-2 py-3">
              {navItems.map(({ href, label, icon: Icon }) => {
                const isActive =
                  href === '/ora-panel'
                    ? pathname === '/ora-panel'
                    : pathname.startsWith(href);

                return (
                  <Link
                    key={href}
                    href={href}
                    title={collapsed ? label : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-ora-cream font-medium text-ora-charcoal'
                        : 'text-ora-charcoal-light hover:bg-ora-cream-light'
                    } ${collapsed ? 'justify-center px-0' : ''}`}
                  >
                    <Icon className="h-4 w-4 shrink-0 stroke-1" />
                    {!collapsed && <span>{label}</span>}
                  </Link>
                );
              })}
            </nav>

            {/* Logout */}
            <div className="border-t border-ora-sand px-2 py-3">
              <button
                onClick={handleLogout}
                title={collapsed ? 'Logout' : undefined}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm text-ora-charcoal-light hover:bg-ora-cream-light transition-colors ${collapsed ? 'justify-center px-0' : ''}`}
              >
                <LogOut className="h-4 w-4 shrink-0 stroke-1" />
                {!collapsed && <span>Logout</span>}
              </button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className={`${mainMargin} flex-1 bg-ora-cream-light p-8 min-h-screen transition-all duration-200`}>
          {children}
        </main>
      </div>
    </QueryClientProvider>
  );
}
