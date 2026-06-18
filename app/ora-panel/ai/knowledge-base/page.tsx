'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ListSkeleton } from '@/components/ui/panel-skeletons';
import {
  Plus,
  Search,
  RefreshCw,
  FileText,
  Globe,
  BookOpen,
  Sparkles,
} from 'lucide-react';

const SOURCE_TYPES = ['manual', 'blog_sync', 'construction_update', 'faq', 'policy'] as const;
const LOCALES = ['en', 'ar'] as const;

function getSyncBadge(sourceType: string, lastIndexedAt: string | null) {
  if (sourceType !== 'blog_sync') return null;
  if (!lastIndexedAt) return { label: 'Missing', cls: 'bg-ora-error/10 text-ora-error' };
  const age = Date.now() - new Date(lastIndexedAt).getTime();
  if (age > 7 * 24 * 60 * 60 * 1000) return { label: 'Stale', cls: 'bg-ora-warning/10 text-ora-warning' };
  return { label: 'Synced', cls: 'bg-ora-success/10 text-ora-success' };
}

export default function KnowledgeBasePage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sourceType, setSourceType] = useState('');
  const [category, setCategory] = useState('');
  const [locale, setLocale] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['ai-knowledge-base', page, sourceType, category, locale, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (sourceType) params.set('sourceType', sourceType);
      if (category) params.set('category', category);
      if (locale) params.set('locale', locale);
      if (search) params.set('search', search);
      const r = await fetch(`/api/ai/knowledge-base?${params}`, { credentials: 'include' });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(json?.error ?? `HTTP ${r.status}`);
      }
      return json;
    },
  });

  const reindex = useMutation({
    mutationFn: () => fetch('/api/ai/knowledge-base/reindex', { method: 'POST' }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ai-knowledge-base'] }),
  });

  const reembed = useMutation({
    mutationFn: () =>
      fetch('/api/ai/knowledge-base/reembed-all', { method: 'POST' }).then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error ?? 'Re-embed failed');
        return json;
      }),
    onSuccess: (json) => {
      queryClient.invalidateQueries({ queryKey: ['ai-knowledge-base'] });
      const data = json?.data;
      if (data) {
        const failures = data.failures?.length ?? 0;
        const msg = failures
          ? `Re-embedded ${data.documentsProcessed}/${data.totalDocuments} docs (${data.chunksGenerated} chunks). ${failures} failed.`
          : `Re-embedded ${data.documentsProcessed} docs / ${data.chunksGenerated} chunks.`;
        // eslint-disable-next-line no-alert
        alert(msg);
      }
    },
    onError: (err: Error) => {
      // eslint-disable-next-line no-alert
      alert(`Re-embed failed: ${err.message}`);
    },
  });

  const docs = data?.documents ?? data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20) || 1;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">AI Knowledge Base</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Manage documents indexed for AI retrieval</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (confirm('Regenerate embeddings for ALL knowledge documents using the current AI gateway? This may take a while.')) {
                reembed.mutate();
              }
            }}
            disabled={reembed.isPending}
            title="Regenerate vectors for every document — use after switching the AI / embedding model."
            className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors disabled:opacity-50"
          >
            <Sparkles className={`h-4 w-4 stroke-1 ${reembed.isPending ? 'animate-pulse' : ''}`} />
            {reembed.isPending ? 'Re-embedding…' : 'Re-embed All'}
          </button>
          <button
            onClick={() => reindex.mutate()}
            disabled={reindex.isPending}
            className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 stroke-1 ${reindex.isPending ? 'animate-spin' : ''}`} />
            Re-index Blog
          </button>
          <Link
            href="/ora-panel/ai/knowledge-base/new"
            className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
          >
            <Plus className="h-4 w-4 stroke-1" />
            Add Document
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-1 text-ora-muted" />
          <input
            type="text"
            placeholder="Search by title…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="h-10 w-full border border-ora-stone bg-ora-white pl-10 pr-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
        <select
          value={sourceType}
          onChange={(e) => { setSourceType(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All sources</option>
          {SOURCE_TYPES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Category…"
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1); }}
          className="h-10 w-40 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        />
        <select
          value={locale}
          onChange={(e) => { setLocale(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All locales</option>
          <option value="en">English</option>
          <option value="ar">Arabic</option>
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <ListSkeleton rows={3} rowClassName="rounded-none" />
      ) : error ? (
        <div className="border border-ora-error/30 bg-ora-error/5 p-6 text-sm text-ora-error">
          <strong className="block">Failed to load knowledge base.</strong>
          <span className="mt-1 block opacity-80">{(error as Error).message}</span>
        </div>
      ) : docs.length === 0 ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <BookOpen className="mx-auto h-10 w-10 stroke-1 text-ora-muted" />
          <p className="mt-2 text-sm text-ora-muted">No documents found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((doc: any) => {
            const sync = getSyncBadge(doc.sourceType, doc.lastIndexedAt);
            return (
              <Link
                key={doc.id}
                href={`/ora-panel/ai/knowledge-base/${doc.id}`}
                className="flex items-center gap-4 border border-ora-sand/60 bg-ora-white p-4 hover:bg-ora-cream-light transition-colors"
              >
                <FileText className="h-5 w-5 shrink-0 stroke-1 text-ora-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ora-charcoal truncate">{doc.title}</span>
                    <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-ora-gold/10 text-ora-gold-dark">
                      {doc.sourceType?.replace(/_/g, ' ')}
                    </span>
                    {doc.category && (
                      <span className="inline-block px-2 py-0.5 text-[10px] font-medium bg-ora-sand/50 text-ora-charcoal-light">
                        {doc.category}
                      </span>
                    )}
                    <span className="inline-block px-2 py-0.5 text-[10px] font-medium bg-ora-info/10 text-ora-info uppercase">
                      {doc.locale}
                    </span>
                    {sync && (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${sync.cls}`}>
                        {sync.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ora-muted truncate max-w-xl">
                    {doc.content?.slice(0, 120)}…
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-ora-muted">
                    {doc.lastIndexedAt ? new Date(doc.lastIndexedAt).toLocaleDateString() : '—'}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="h-9 px-4 border border-ora-sand bg-ora-cream text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-ora-muted">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="h-9 px-4 border border-ora-sand bg-ora-cream text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
