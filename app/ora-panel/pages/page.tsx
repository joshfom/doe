'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePages, useCloneLocale, useSiteSettings } from '@/lib/cms/hooks';
import { getLocaleCompletionStatus } from '@/lib/cms/utils/locale-indicator';
import type { PageStatus } from '@/lib/cms/types';
import { Plus, Search } from 'lucide-react';

const STATUS_DOT: Record<string, string> = {
  green: 'bg-ora-success',
  amber: 'bg-ora-warning',
  gray: 'bg-ora-stone-dark',
};

export default function PageIndexPage() {
  const [statusFilter, setStatusFilter] = useState<PageStatus | ''>('');
  const [search, setSearch] = useState('');

  const { data: groups, isLoading } = usePages(
    statusFilter ? { status: statusFilter as PageStatus } : undefined
  );
  const { data: settingsEntries } = useSiteSettings();
  const cloneLocale = useCloneLocale();

  const homePageId = useMemo(() => {
    if (!settingsEntries) return null;
    const entry = settingsEntries.find((e) => e.key === 'home_page_id');
    return entry?.value ?? null;
  }, [settingsEntries]);

  const filtered = (groups ?? []).filter((g) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      g.locales.en?.title.toLowerCase().includes(q) ||
      g.locales.ar?.title.toLowerCase().includes(q) ||
      g.slug.toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Pages</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Manage your site pages</p>
        </div>
        <Link
          href="/ora-panel/pages/new"
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
        >
          <Plus className="h-4 w-4 stroke-1" />
          New Page
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-1 text-ora-muted" />
          <input
            type="text"
            placeholder="Search by title or slug…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full border border-ora-stone bg-ora-white pl-10 pr-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as PageStatus | '')}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
      </div>

      {/* Page list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded bg-ora-sand/60" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <p className="text-sm text-ora-muted">No pages found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((group) => {
            const status = getLocaleCompletionStatus(group);
            const primary = group.locales.en ?? group.locales.ar;
            const primaryId = primary?.id;
            const isHome =
              homePageId != null &&
              (group.locales.en?.id === homePageId ||
                group.locales.ar?.id === homePageId);

            return (
              <div
                key={group.namespace}
                className="flex items-center gap-4 border border-ora-sand/60 bg-ora-white p-4"
              >
                {/* Locale dot */}
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                  title={`Locale status: ${status}`}
                />

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={primaryId ? `/ora-panel/pages/${primaryId}` : '#'}
                      className="text-sm font-medium text-ora-charcoal hover:text-ora-gold transition-colors"
                    >
                      {primary?.title ?? group.slug}
                    </Link>
                    {isHome && (
                      <span className="inline-block bg-ora-gold/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-ora-gold-dark">
                        Home
                      </span>
                    )}
                    {group.isSystem && (
                      <span className="inline-block bg-ora-info/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-ora-info">
                        System
                      </span>
                    )}
                    {(group.locales.en?.status === 'pending_review' || group.locales.ar?.status === 'pending_review') && (
                      <span className="inline-block rounded-full bg-ora-warning/10 px-2 py-0.5 text-[10px] font-medium text-ora-warning">Pending Review</span>
                    )}
                  </div>
                  <p className="text-xs text-ora-muted font-mono">/{group.slug}</p>
                </div>

                {/* Locale badges */}
                <div className="flex gap-2">
                  {group.locales.en ? (
                    <Link
                      href={`/ora-panel/pages/${group.locales.en.id}`}
                      className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${
                        group.locales.en.status === 'published'
                          ? 'bg-ora-success/10 text-ora-success'
                          : 'bg-ora-sand text-ora-charcoal-light'
                      }`}
                    >
                      EN
                    </Link>
                  ) : (
                    <span className="inline-block rounded-full bg-ora-sand/50 px-3 py-0.5 text-xs text-ora-muted">
                      EN —
                    </span>
                  )}
                  {group.locales.ar ? (
                    <Link
                      href={`/ora-panel/pages/${group.locales.ar.id}`}
                      className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${
                        group.locales.ar.status === 'published'
                          ? 'bg-ora-success/10 text-ora-success'
                          : 'bg-ora-sand text-ora-charcoal-light'
                      }`}
                    >
                      AR
                    </Link>
                  ) : group.locales.en ? (
                    <button
                      onClick={() => cloneLocale.mutate(group.locales.en!.id)}
                      disabled={cloneLocale.isPending}
                      className="inline-flex items-center gap-1 rounded-full bg-ora-gold/10 px-3 py-0.5 text-xs font-medium text-ora-gold-dark hover:bg-ora-gold/20 transition-colors"
                    >
                      <Plus className="h-3 w-3 stroke-1" />
                      Create AR
                    </button>
                  ) : (
                    <span className="inline-block rounded-full bg-ora-sand/50 px-3 py-0.5 text-xs text-ora-muted">
                      AR —
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
