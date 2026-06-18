'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  usePosts,
  useTrashedPosts,
  useRestorePost,
  usePermanentDeletePost,
  useClonePostLocale,
} from '@/lib/cms/hooks';
import type { PostStatus, PostType, Locale } from '@/lib/cms/types';
import { Plus, Search, Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import { ListSkeleton } from '@/components/ui/panel-skeletons';

const STATUS_DOT: Record<string, string> = {
  green: 'bg-ora-success',
  amber: 'bg-ora-warning',
  gray: 'bg-ora-stone-dark',
};

function getPostLocaleStatus(group: { locales: { en?: { status: string }; ar?: { status: string } } }) {
  const enPub = group.locales.en?.status === 'published';
  const arPub = group.locales.ar?.status === 'published';
  if (enPub && arPub) return 'green';
  if (enPub || arPub) return 'amber';
  return 'gray';
}

export default function BlogListingPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'draft' | 'published' | ''>('');
  const [typeFilter, setTypeFilter] = useState<PostType | ''>('');
  const [localeFilter, setLocaleFilter] = useState<Locale | ''>('');
  const [showTrash, setShowTrash] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const filters: Record<string, string> = {};
  if (statusFilter) filters.status = statusFilter;
  if (typeFilter) filters.postType = typeFilter;
  if (localeFilter) filters.locale = localeFilter;

  const { data: groups, isLoading } = usePosts(
    Object.keys(filters).length > 0 ? (filters as any) : undefined
  );
  const { data: trashedPosts, isLoading: trashLoading } = useTrashedPosts();
  const restorePost = useRestorePost();
  const permanentDelete = usePermanentDeletePost();
  const cloneLocale = useClonePostLocale();

  const filtered = useMemo(() => {
    if (!groups) return [];
    if (!search) return groups;
    const q = search.toLowerCase();
    return groups.filter(
      (g) =>
        g.locales.en?.title.toLowerCase().includes(q) ||
        g.locales.ar?.title.toLowerCase().includes(q) ||
        g.slug.toLowerCase().includes(q)
    );
  }, [groups, search]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Blog</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Manage blog posts and news articles</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/ora-panel/blog/stats"
            className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
          >
            Stats
          </Link>
          <Link
            href="/ora-panel/blog/categories"
            className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
          >
            Categories
          </Link>
          <Link
            href="/ora-panel/blog/tags"
            className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
          >
            Tags
          </Link>
          <Link
            href="/ora-panel/blog/new"
            className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
          >
            <Plus className="h-4 w-4 stroke-1" />
            New Post
          </Link>
        </div>
      </div>

      {/* Tabs: Posts / Trash */}
      <div className="mb-4 flex gap-1 border border-ora-sand bg-ora-white p-1 w-fit">
        <button
          onClick={() => setShowTrash(false)}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            !showTrash ? 'bg-ora-charcoal text-white' : 'text-ora-charcoal-light hover:bg-ora-cream-light'
          }`}
        >
          Posts
        </button>
        <button
          onClick={() => setShowTrash(true)}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
            showTrash ? 'bg-ora-charcoal text-white' : 'text-ora-charcoal-light hover:bg-ora-cream-light'
          }`}
        >
          <Trash2 className="h-3.5 w-3.5 stroke-1" />
          Trash
        </button>
      </div>

      {!showTrash ? (
        <>
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
              onChange={(e) => setStatusFilter(e.target.value as 'draft' | 'published' | '')}
              className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            >
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as PostType | '')}
              className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            >
              <option value="">All types</option>
              <option value="blog">Blog</option>
              <option value="news">News</option>
            </select>
            <select
              value={localeFilter}
              onChange={(e) => setLocaleFilter(e.target.value as Locale | '')}
              className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            >
              <option value="">All locales</option>
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </select>
          </div>

          {/* Post list */}
          {isLoading ? (
            <ListSkeleton rows={3} rowClassName="rounded-none" />
          ) : filtered.length === 0 ? (
            <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
              <p className="text-sm text-ora-muted">No posts found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((group) => {
                const status = getPostLocaleStatus(group);
                const primary = group.locales.en ?? group.locales.ar;
                const primaryId = primary?.id;

                return (
                  <div
                    key={group.namespace}
                    className="flex items-center gap-4 border border-ora-sand/60 bg-ora-white p-4"
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                      title={`Locale status: ${status}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link
                          href={primaryId ? `/ora-panel/blog/${primaryId}` : '#'}
                          className="text-sm font-medium text-ora-charcoal hover:text-ora-gold transition-colors"
                        >
                          {primary?.title ?? group.slug}
                        </Link>
                        <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                          group.postType === 'news'
                            ? 'bg-ora-info/10 text-ora-info'
                            : 'bg-ora-gold/10 text-ora-gold-dark'
                        }`}>
                          {group.postType}
                        </span>
                        {(group.locales.en?.status === 'pending_review' || group.locales.ar?.status === 'pending_review') && (
                          <span className="inline-block rounded-full bg-ora-warning/10 px-2 py-0.5 text-[10px] font-medium text-ora-warning">Pending Review</span>
                        )}
                      </div>
                      <p className="text-xs text-ora-muted font-mono">/{group.slug}</p>
                    </div>
                    <div className="flex gap-2">
                      {group.locales.en ? (
                        <Link
                          href={`/ora-panel/blog/${group.locales.en.id}`}
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
                          href={`/ora-panel/blog/${group.locales.ar.id}`}
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
        </>
      ) : (
        /* Trash view */
        <>
          {trashLoading ? (
            <ListSkeleton rows={3} rowClassName="rounded-none" />
          ) : !trashedPosts?.length ? (
            <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
              <p className="text-sm text-ora-muted">Trash is empty</p>
            </div>
          ) : (
            <div className="space-y-2">
              {trashedPosts.map((post) => (
                <div
                  key={post.id}
                  className="flex items-center gap-4 border border-ora-sand/60 bg-ora-white p-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ora-charcoal">{post.title}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-ora-muted">
                      <span>Trashed {post.trashedAt ? new Date(post.trashedAt).toLocaleDateString() : '—'}</span>
                      <span className="text-ora-warning">{post.daysRemaining} days remaining</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => restorePost.mutate(post.id)}
                      disabled={restorePost.isPending}
                      className="inline-flex h-9 items-center gap-1.5 border border-ora-sand bg-ora-cream px-4 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5 stroke-1" />
                      Restore
                    </button>
                    {confirmDeleteId === post.id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            permanentDelete.mutate(post.id);
                            setConfirmDeleteId(null);
                          }}
                          disabled={permanentDelete.isPending}
                          className="h-9 bg-ora-error px-4 text-sm text-ora-white hover:bg-ora-error/90 transition-colors"
                        >
                          Confirm Delete
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="h-9 border border-ora-sand bg-ora-cream px-4 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(post.id)}
                        className="inline-flex h-9 items-center gap-1.5 bg-ora-error/10 px-4 text-sm text-ora-error hover:bg-ora-error/20 transition-colors"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 stroke-1" />
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
