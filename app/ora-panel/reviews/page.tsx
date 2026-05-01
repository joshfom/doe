'use client';

import Link from 'next/link';
import { usePendingApprovals } from '@/lib/cms/hooks';
import { ClipboardCheck } from 'lucide-react';
import type { ContentModule } from '@/lib/cms/types';

const MODULE_LABELS: Record<ContentModule, string> = {
  pages: 'Pages',
  blog: 'Blog',
  news: 'News',
  construction_updates: 'Updates',
};

const MODULE_BADGE: Record<ContentModule, string> = {
  pages: 'bg-ora-info/10 text-ora-info',
  blog: 'bg-ora-gold/10 text-ora-gold-dark',
  news: 'bg-ora-warning/10 text-ora-warning',
  construction_updates: 'bg-ora-success/10 text-ora-success',
};

function contentDetailHref(contentId: string, contentModule: ContentModule): string {
  switch (contentModule) {
    case 'blog':
    case 'news':
      return `/ora-panel/blog/${contentId}`;
    case 'pages':
      return `/ora-panel/pages/${contentId}`;
    default:
      return `/ora-panel/pages/${contentId}`;
  }
}

export default function ReviewDashboardPage() {
  const { data: pending, isLoading } = usePendingApprovals();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Reviews</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          Content awaiting your approval
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse bg-ora-sand/60" />
          ))}
        </div>
      ) : !pending?.length ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <ClipboardCheck className="mx-auto mb-3 h-10 w-10 stroke-1 text-ora-muted" />
          <p className="text-sm text-ora-muted">No pending reviews</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pending.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-4 border border-ora-sand/60 bg-ora-white p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={contentDetailHref(item.contentId, item.contentModule)}
                    className="text-sm font-medium text-ora-charcoal hover:text-ora-gold transition-colors"
                  >
                    {item.contentTitle}
                  </Link>
                  <span
                    className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${
                      MODULE_BADGE[item.contentModule] ?? 'bg-ora-sand text-ora-charcoal-light'
                    }`}
                  >
                    {MODULE_LABELS[item.contentModule] ?? item.contentModule}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-ora-muted">
                  <span>by {item.submitterName}</span>
                  <span>·</span>
                  <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <span className="inline-block rounded-full bg-ora-warning/10 px-3 py-0.5 text-xs font-medium text-ora-warning">
                  {item.status}
                </span>
              </div>

              <Link
                href={contentDetailHref(item.contentId, item.contentModule)}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 bg-ora-charcoal px-5 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
              >
                Review
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
