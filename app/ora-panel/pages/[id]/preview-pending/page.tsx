'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import '@puckeditor/core/dist/index.css';
import { Render } from '@puckeditor/core';
import { pageBuilderConfig } from '@/lib/page-builder/config';
import type { PageData } from '@/lib/page-builder/types';
import { apiFetch } from '@/lib/cms/hooks/api';
import { Skeleton } from '@/components/ui/skeleton';

export default function PreviewPendingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadPendingDraft() {
      try {
        const res = await apiFetch<{ data: PageData }>(`/api/pages/${id}/pending-draft`);
        if (!cancelled) setData(res.data);
      } catch (err: unknown) {
        if (!cancelled) {
          const e = err as { error?: string };
          setError(e?.error || 'No pending draft found');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPendingDraft();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen">
        {/* Header bar */}
        <div className="sticky top-0 z-50 flex items-center justify-between border-b border-ora-sand bg-ora-white px-6 py-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-8 w-28" />
        </div>
        {/* Rendered-page placeholder */}
        <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
          <Skeleton className="h-72 w-full rounded-lg" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-ora-error">{error || 'No pending draft available'}</p>
        <Link
          href={`/ora-panel/pages/${id}`}
          className="h-10 inline-flex items-center bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
        >
          Back to Page
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header bar */}
      <div className="sticky top-0 z-50 flex items-center justify-between border-b border-ora-sand bg-ora-white px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 bg-amber-500/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-amber-700">
            Preview: Pending Draft
          </span>
        </div>
        <Link
          href={`/ora-panel/pages/${id}`}
          className="inline-flex h-8 items-center gap-1.5 border border-ora-sand bg-ora-cream px-4 text-xs text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
        >
          ← Back to Page
        </Link>
      </div>

      {/* Full-width read-only render */}
      <div className="w-full">
        <Render config={pageBuilderConfig} data={data} />
      </div>
    </div>
  );
}
