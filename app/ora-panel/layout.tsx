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
  Newspaper,
  Image as ImageIcon,
  CheckSquare,
  Ticket,
  Settings,
  LogOut,
  MapPin,
  Building2,
  BrainCircuit,
  MessageSquare,
  Users,
  CalendarDays,
  TrendingUp,
  DollarSign,
  BarChart3,
  Network,
  PhoneCall,
  Sparkles,
  Bot,
  Telescope,
} from 'lucide-react';
import type { SessionData } from '@/lib/types/session';
import { Skeleton } from '@/components/ui/skeleton';
import { DemoPersonaProvider } from './_components/demo-persona';
import { PanelTopBar } from './_components/PanelTopBar';

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
  { href: '/ora-panel', label: 'Feed', icon: LayoutDashboard, permission: null },
  { href: '/ora-panel/leads', label: 'Lead Engine', icon: Sparkles, permission: 'leads:read' },
  { href: '/ora-panel/prospecting', label: 'Prospecting', icon: Telescope, permission: 'leads:read' },
  { href: '/ora-panel/tickets', label: 'Tickets', icon: Ticket, permission: 'tickets:read' },
  { href: '/ora-panel/ai/appointments', label: 'Appointments', icon: CalendarDays, permission: 'ai:appointments:manage' },
  { href: '/ora-panel/calendar', label: 'Calendar', icon: CalendarDays, permission: 'tickets:read' },
  { href: '/ora-panel/ai', label: 'My AI', icon: Bot, permission: 'ai:conversations:read' },
  { href: '/ora-panel/ai/clients', label: 'People', icon: Users, permission: 'ai:clients:manage' },
  { href: '/ora-panel/pages', label: 'Pages', icon: FileText, permission: 'pages:read' },
  { href: '/ora-panel/blog', label: 'Blog', icon: Newspaper, permission: 'posts:read' },
  { href: '/ora-panel/communities', label: 'Communities', icon: MapPin, permission: 'communities:read' },
  { href: '/ora-panel/projects', label: 'Projects', icon: Building2, permission: 'projects:read' },
  { href: '/ora-panel/media', label: 'Media', icon: ImageIcon, permission: 'media:read' },
  { href: '/ora-panel/reviews', label: 'Reviews', icon: CheckSquare, permission: 'bookings:read' },
  { href: '/ora-panel/ai/knowledge-base', label: 'AI Knowledge', icon: BrainCircuit, permission: 'ai:knowledge-base:manage' },
  { href: '/ora-panel/ai/conversations', label: 'AI Conversations', icon: MessageSquare, permission: 'ai:conversations:read' },
  { href: '/ora-panel/voice-console', label: 'Voice Console', icon: PhoneCall, permission: 'voice:console' },
  { href: '/ora-panel/marketing/dashboard', label: 'Marketing', icon: TrendingUp, permission: 'analytics:read' },
  { href: '/ora-panel/marketing/spend', label: 'Ad Spend', icon: DollarSign, permission: 'analytics:read' },
  { href: '/ora-panel/marketing/utm-analytics', label: 'UTM Analytics', icon: BarChart3, permission: 'analytics:read' },
  { href: '/ora-panel/settings', label: 'Settings', icon: Settings, permission: 'settings:update' },
  { href: '/ora-panel/sitemap', label: 'Sitemap', icon: Network, permission: 'settings:update' },
];

/**
 * Check if a user's permission set satisfies a required permission.
 * Supports exact match, resource-level wildcard (resource:*), and global wildcard (*:*).
 */
function hasPermission(permissions: string[], required: string): boolean {
  if (permissions.includes('*:*')) return true;
  if (permissions.includes(required)) return true;

  const colonIdx = required.indexOf(':');
  if (colonIdx === -1) return false;

  const resource = required.slice(0, colonIdx);
  return permissions.includes(`${resource}:*`);
}

export default function OraPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);

  const isLoginPage = pathname === '/ora-panel/login' || pathname === '/ora-panel/register';
  // The live page editor (/ora-panel/live/[id]) renders chrome-free and full-bleed,
  // mirroring the login route: no sidebar, no nav, no main padding. Server-side
  // pages:edit authorization is enforced in the route's server component.
  const isLiveEditor = pathname?.startsWith('/ora-panel/live/') ?? false;
  const isChromeless = isLoginPage || isLiveEditor;

  useEffect(() => {
    if (isChromeless) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Not authenticated');
        const json = await res.json();
        if (!json?.data?.userId) throw new Error('Not authenticated');
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setSession(json.data as SessionData);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Stop rendering "Loading…" forever — clear loading and redirect.
        setSession(null);
        setLoading(false);
        const next = encodeURIComponent(pathname || '/ora-panel');
        router.replace(`/ora-panel/login?next=${next}`);
      });
    return () => {
      cancelled = true;
    };
  }, [isChromeless, pathname, router]);

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

  if (loading) {
    return (
      <div className="flex min-h-screen bg-ora-cream-light">
        {/* Sidebar shell */}
        <aside className="hidden w-60 shrink-0 flex-col gap-2 border-r border-ora-sand/60 bg-ora-white p-4 md:flex">
          <Skeleton className="mb-4 h-8 w-32" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </aside>
        {/* Content shell */}
        <main className="flex-1 p-6">
          <div className="mb-6 space-y-2">
            <Skeleton className="h-7 w-56" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (isChromeless) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  // Hard-stop: if we exited loading without a session, the redirect is
  // already in flight — render nothing rather than leaking the panel shell.
  if (!session) {
    return null;
  }

  const userPermissions = session?.permissions ?? [];
  const visibleNavItems = navItems.filter(
    (item) => item.permission === null || hasPermission(userPermissions, item.permission)
  );

  return (
    <QueryClientProvider client={queryClient}>
      <DemoPersonaProvider>
      <div className="flex min-h-screen" style={{ fontFamily: "var(--font-poppins), Poppins, system-ui, sans-serif" }}>
        {/* Top-right user menu + session-only persona toggle (demo). */}
        <PanelTopBar userName={session?.name} />
        {/* Sidebar — expands on hover, collapses on mouse leave */}
        <aside
          onMouseEnter={() => setCollapsed(false)}
          onMouseLeave={() => setCollapsed(true)}
          className={`fixed inset-y-0 left-0 z-40 ${collapsed ? 'w-16' : 'w-56'} bg-ora-charcoal transition-all duration-200 ${!collapsed ? 'shadow-xl' : ''}`}
        >
          <div className="flex h-full flex-col">
            {/* Logo */}
            <div className="flex items-center border-b border-white/10 px-3 py-4">
              {collapsed ? (
                <Image
                  src="/logo.svg"
                  alt="ORA"
                  width={24}
                  height={24}
                  className="mx-auto invert"
                />
              ) : (
                <Image
                  src="/logo.svg"
                  alt="ORA"
                  width={60}
                  height={22}
                  className="ml-1 invert"
                />
              )}
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 px-2 py-3 overflow-y-auto">
              {visibleNavItems.map(({ href, label, icon: Icon }) => {
                const isActive =
                  href === '/ora-panel'
                    ? pathname === '/ora-panel'
                    : pathname.startsWith(href);

                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                      isActive
                        ? 'bg-white/15 font-medium text-white'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    } ${collapsed ? 'justify-center px-0' : ''}`}
                  >
                    <Icon className="h-5 w-5 shrink-0 stroke-[1.5]" />
                    {!collapsed && <span className="whitespace-nowrap">{label}</span>}
                  </Link>
                );
              })}
            </nav>

            {/* Logout */}
            <div className="border-t border-white/10 px-2 py-3">
              <button
                onClick={handleLogout}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors ${collapsed ? 'justify-center px-0' : ''}`}
              >
                <LogOut className="h-5 w-5 shrink-0 stroke-[1.5]" />
                {!collapsed && <span>Logout</span>}
              </button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="ml-16 flex-1 bg-ora-cream-light p-8 min-h-screen transition-all duration-200">
          {children}
        </main>
      </div>
      </DemoPersonaProvider>
    </QueryClientProvider>
  );
}
