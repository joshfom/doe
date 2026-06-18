'use client';

// ── Classic_Panel dashboard content (extracted from app/ora-panel/page.tsx) ──
//
// This is the original classic CMS dashboard (stat cards: Total Pages /
// Published / Drafts / Submissions / Media). It used to live directly in
// `app/ora-panel/page.tsx`, but `/ora-panel` is now the agent-first home
// (`app/ora-panel/page.tsx`). The dashboard body was moved here, into an
// underscore-prefixed `_components` folder (NOT a route), so it can be rendered
// as the Degraded_Mode fallback (`_home/ClassicFallback.tsx`) without the page
// importing itself recursively. The logic is identical to the previous page.

import { usePages, useMedia, useFormSubmissions } from '@/lib/cms/hooks';
import { FileText, Globe, PenLine, Inbox, Image } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export function ClassicDashboard() {
  const { data: groups, isLoading: pagesLoading } = usePages();
  const { data: media, isLoading: mediaLoading } = useMedia();
  const { data: submissions, isLoading: subsLoading } = useFormSubmissions();

  const allPages = groups?.flatMap((g) => [g.locales.en, g.locales.ar].filter(Boolean)) ?? [];
  const totalPages = allPages.length;
  const publishedPages = allPages.filter((p) => p?.status === 'published').length;
  const draftPages = allPages.filter((p) => p?.status === 'draft').length;
  const totalMedia = media?.length ?? 0;
  const totalSubmissions = submissions?.reduce((sum, g) => sum + g.submissions.length, 0) ?? 0;

  const stats = [
    { label: 'Total Pages', value: totalPages, icon: FileText },
    { label: 'Published', value: publishedPages, icon: Globe },
    { label: 'Drafts', value: draftPages, icon: PenLine },
    { label: 'Submissions', value: totalSubmissions, icon: Inbox },
    { label: 'Media Items', value: totalMedia, icon: Image },
  ];

  const isLoading = pagesLoading || mediaLoading || subsLoading;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Dashboard</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Overview of your CMS content</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="bg-ora-white border border-ora-sand/60 p-6"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs text-ora-muted">{label}</span>
              <Icon className="h-4 w-4 stroke-1 text-ora-muted" />
            </div>
            <div className="mt-2">
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-semibold text-ora-charcoal">{value}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ClassicDashboard;
