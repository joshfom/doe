'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  useBlogStats,
  useTopPosts,
  useShareBreakdown,
} from '@/lib/cms/hooks';
import type { PostType } from '@/lib/cms/types';
import { ChevronRight, Eye, Share2, FileText, BarChart3 } from 'lucide-react';
import { ListSkeleton } from '@/components/ui/panel-skeletons';

export default function StatsPage() {
  const [typeFilter, setTypeFilter] = useState<PostType | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const statsFilters: Record<string, string> = {};
  if (typeFilter) statsFilters.postType = typeFilter;
  if (dateFrom) statsFilters.from = dateFrom;
  if (dateTo) statsFilters.to = dateTo;

  const { data: stats, isLoading: statsLoading } = useBlogStats(
    Object.keys(statsFilters).length > 0 ? (statsFilters as any) : undefined
  );
  const { data: topPosts, isLoading: topLoading } = useTopPosts(
    typeFilter ? { postType: typeFilter as PostType } : undefined
  );
  const { data: shares, isLoading: sharesLoading } = useShareBreakdown();

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Feed</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/blog" className="hover:text-ora-charcoal transition-colors">Blog</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">Stats</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Blog Stats</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">View analytics and performance metrics</p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as PostType | '')}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All types</option>
          <option value="blog">Blog</option>
          <option value="news">News</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          placeholder="From"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          placeholder="To"
        />
      </div>

      {/* Summary cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total Posts', value: stats?.totalPosts ?? 0, icon: FileText, color: 'text-ora-charcoal' },
          { label: 'Total Views', value: stats?.totalViews ?? 0, icon: Eye, color: 'text-ora-gold-dark' },
          { label: 'Total Shares', value: stats?.totalShares ?? 0, icon: Share2, color: 'text-ora-info' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="border border-ora-sand/60 bg-ora-white p-6">
            <div className="flex items-center gap-3">
              <Icon className={`h-5 w-5 stroke-1 ${color}`} />
              <span className="text-xs text-ora-muted uppercase tracking-widest font-bold">{label}</span>
            </div>
            <p className="mt-3 text-3xl font-semibold text-ora-charcoal">
              {statsLoading ? '—' : value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Posts */}
        <div className="border border-ora-sand/60 bg-ora-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 stroke-1 text-ora-gold-dark" />
            <h2 className="text-sm font-semibold text-ora-charcoal">Top Posts by Views</h2>
          </div>
          {topLoading ? (
            <ListSkeleton rows={3} rowClassName="h-10 rounded-none" className="space-y-2" />
          ) : !topPosts?.length ? (
            <p className="text-sm text-ora-muted">No data yet</p>
          ) : (
            <div className="space-y-1">
              {topPosts.map((post, i) => (
                <div key={post.postId} className="flex items-center gap-3 py-2">
                  <span className="w-6 text-center text-xs font-bold text-ora-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/ora-panel/blog/${post.postId}`} className="text-sm text-ora-charcoal hover:text-ora-gold transition-colors truncate block">
                      {post.title}
                    </Link>
                    <span className="text-[10px] text-ora-muted uppercase">{post.postType} · {post.locale}</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-ora-charcoal-light">
                    <Eye className="h-3.5 w-3.5 stroke-1" />
                    {post.viewCount.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Share Breakdown */}
        <div className="border border-ora-sand/60 bg-ora-white p-6">
          <div className="mb-4 flex items-center gap-2">
            <Share2 className="h-4 w-4 stroke-1 text-ora-info" />
            <h2 className="text-sm font-semibold text-ora-charcoal">Shares by Platform</h2>
          </div>
          {sharesLoading ? (
            <ListSkeleton rows={3} rowClassName="h-10 rounded-none" className="space-y-2" />
          ) : !shares?.length ? (
            <p className="text-sm text-ora-muted">No share data yet</p>
          ) : (
            <div className="space-y-3">
              {shares.map((s) => {
                const maxTotal = Math.max(...shares.map((x) => x.total), 1);
                const pct = (s.total / maxTotal) * 100;
                return (
                  <div key={s.platform}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-ora-charcoal capitalize">{s.platform.replace('_', ' ')}</span>
                      <span className="text-sm font-medium text-ora-charcoal">{s.total.toLocaleString()}</span>
                    </div>
                    <div className="h-2 w-full bg-ora-sand/60">
                      <div className="h-full bg-ora-gold transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
