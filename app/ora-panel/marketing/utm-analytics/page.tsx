'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ShieldAlert,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Zap,
  X,
  Users,
  MousePointerClick,
  Timer,
  Target,
  TrendingUp,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import type { SessionData } from '@/lib/types/session';

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const PAGE_SIZE = 1000;

// ── Types ────────────────────────────────────────────────────────────────────

interface UtmAnalyticsRow {
  id: string;
  taggedUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string | null;
  utmContent: string | null;
  project: string | null;
  autoRegistered: boolean;
  createdAt: string;
  totalHits: number;
  uniqueVisitors: number;
  bounceRate: number;
  conversions: number;
}

interface UtmAnalyticsResponse {
  data: UtmAnalyticsRow[];
  total: number;
  page: number;
  pageSize: number;
  sources: string[];
  projects: string[];
  stale?: boolean;
}

interface UtmDetailResponse {
  link: UtmAnalyticsRow;
  avgSessionDuration: number; // seconds
  conversionRate: number; // 0-100
  dailyHits: Array<{ date: string; hits: number }>;
  topLandingPages: Array<{ path: string; hits: number }>;
}

type SortField =
  | 'taggedUrl'
  | 'utmSource'
  | 'utmMedium'
  | 'utmCampaign'
  | 'totalHits'
  | 'uniqueVisitors'
  | 'bounceRate'
  | 'conversions';

type SortOrder = 'asc' | 'desc';
type DaysWindow = 7 | 30 | 90;

// ── Page Component ───────────────────────────────────────────────────────────

export default function UTMAnalyticsPage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  // Permission check: analytics:read or admin
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Not authenticated');
        const json = await res.json();
        if (!json?.data?.userId) throw new Error('Not authenticated');
        return json.data as SessionData;
      })
      .then((data) => {
        if (cancelled) return;
        const hasAccess =
          data.roles.includes('super_admin') ||
          data.permissions.includes('*:*') ||
          data.permissions.includes('analytics:read') ||
          data.permissions.includes('analytics:*');
        if (!hasAccess) {
          setUnauthorized(true);
          setAuthLoading(false);
          return;
        }
        setAuthLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        router.replace('/ora-panel');
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-ora-muted">Loading…</p>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <ShieldAlert className="h-8 w-8 text-ora-error" />
        <p className="text-sm text-ora-charcoal">
          You do not have permission to view the UTM analytics dashboard.
        </p>
      </div>
    );
  }

  return <UTMDashboardContent />;
}

// ── Dashboard Content ────────────────────────────────────────────────────────

function UTMDashboardContent() {
  // State: time window, filters, pagination, sorting
  const [days, setDays] = useState<DaysWindow>(30);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortField>('totalHits');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [selectedLinkId, setSelectedLinkId] = useState<string | null>(null);

  // Debounce search input (300ms, min 2 chars)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search.length >= 2 ? search : '');
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // Reset page when filters change (but NOT when time window changes - preserves filter state)
  useEffect(() => {
    setPage(1);
  }, [sourceFilter, projectFilter]);

  // Build query params
  const queryParams = new URLSearchParams({
    days: String(days),
    page: String(page),
    sort: sort,
    order: order,
  });
  if (debouncedSearch) queryParams.set('search', debouncedSearch);
  if (sourceFilter) queryParams.set('source', sourceFilter);
  if (projectFilter) queryParams.set('project', projectFilter);

  const { data: response, isLoading } = useQuery<UtmAnalyticsResponse>({
    queryKey: [
      'utm-analytics',
      days,
      debouncedSearch,
      sourceFilter,
      projectFilter,
      page,
      sort,
      order,
    ],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE_URL}/api/utm-analytics?${queryParams.toString()}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch UTM analytics: ${res.status}`);
      }
      const json = await res.json();
      return json.data ?? json;
    },
    retry: 2,
  });

  const handleSort = useCallback(
    (field: SortField) => {
      if (sort === field) {
        setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSort(field);
        setOrder('desc');
      }
    },
    [sort]
  );

  const handleTimeChange = useCallback((newDays: DaysWindow) => {
    // Preserve all filter state, only change days
    setDays(newDays);
  }, []);

  const totalPages = response ? Math.ceil(response.total / PAGE_SIZE) : 0;
  const showPagination = response && response.total > PAGE_SIZE;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">
            UTM Analytics
          </h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Per-link performance metrics and traffic analysis
          </p>
        </div>
        <TimeRangeToggle days={days} onChange={handleTimeChange} />
      </div>

      {/* Filters Bar */}
      <FiltersBar
        search={search}
        onSearchChange={setSearch}
        sourceFilter={sourceFilter}
        onSourceChange={(v) => setSourceFilter(v)}
        projectFilter={projectFilter}
        onProjectChange={(v) => setProjectFilter(v)}
        sources={response?.sources ?? []}
        projects={response?.projects ?? []}
      />

      {/* Loading State */}
      {isLoading && <SkeletonTable />}

      {/* Empty State */}
      {!isLoading && response && response.data?.length === 0 && (
        <EmptyState
          days={days}
          hasFilters={!!(debouncedSearch || sourceFilter || projectFilter)}
          search={debouncedSearch}
          source={sourceFilter}
          project={projectFilter}
        />
      )}

      {/* Data Table */}
      {!isLoading && response && response.data?.length > 0 && (
        <>
          <UTMTable
            rows={response.data}
            sort={sort}
            order={order}
            onSort={handleSort}
            onRowClick={(id) => setSelectedLinkId(id)}
          />

          {/* Pagination */}
          {showPagination && (
            <PaginationControls
              page={page}
              totalPages={totalPages}
              total={response.total}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {/* Detail Sheet */}
      {selectedLinkId && (
        <UTMDetailSheet
          linkId={selectedLinkId}
          days={days}
          onClose={() => setSelectedLinkId(null)}
        />
      )}
    </div>
  );
}

// ── Time Range Toggle ────────────────────────────────────────────────────────

function TimeRangeToggle({
  days,
  onChange,
}: {
  days: DaysWindow;
  onChange: (days: DaysWindow) => void;
}) {
  const options: DaysWindow[] = [7, 30, 90];
  return (
    <div className="inline-flex border border-ora-stone">
      {options.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            days === d
              ? 'bg-ora-charcoal text-ora-white'
              : 'bg-ora-white text-ora-charcoal hover:bg-ora-sand/30'
          }`}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

// ── Filters Bar ──────────────────────────────────────────────────────────────

function FiltersBar({
  search,
  onSearchChange,
  sourceFilter,
  onSourceChange,
  projectFilter,
  onProjectChange,
  sources,
  projects,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  sourceFilter: string;
  onSourceChange: (v: string) => void;
  projectFilter: string;
  onProjectChange: (v: string) => void;
  sources: string[];
  projects: string[];
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {/* Search Input */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ora-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search source, medium, campaign…"
          className="w-full border border-ora-sand/60 bg-ora-white py-2 pl-8 pr-3 text-xs text-ora-charcoal placeholder:text-ora-muted focus:border-ora-charcoal focus:outline-none"
        />
      </div>

      {/* Source Dropdown */}
      <select
        value={sourceFilter}
        onChange={(e) => onSourceChange(e.target.value)}
        className="border border-ora-sand/60 bg-ora-white px-3 py-2 text-xs text-ora-charcoal focus:border-ora-charcoal focus:outline-none"
      >
        <option value="">All Sources</option>
        {sources.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      {/* Project Dropdown */}
      <select
        value={projectFilter}
        onChange={(e) => onProjectChange(e.target.value)}
        className="border border-ora-sand/60 bg-ora-white px-3 py-2 text-xs text-ora-charcoal focus:border-ora-charcoal focus:outline-none"
      >
        <option value="">All Projects</option>
        {projects.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── UTM Table ────────────────────────────────────────────────────────────────

const COLUMNS: Array<{ key: SortField; label: string; align?: 'right' }> = [
  { key: 'taggedUrl', label: 'Tagged URL' },
  { key: 'utmSource', label: 'Source' },
  { key: 'utmMedium', label: 'Medium' },
  { key: 'utmCampaign', label: 'Campaign' },
  { key: 'totalHits', label: 'Hits', align: 'right' },
  { key: 'uniqueVisitors', label: 'Unique Visitors', align: 'right' },
  { key: 'bounceRate', label: 'Bounce Rate', align: 'right' },
  { key: 'conversions', label: 'Conversions', align: 'right' },
];

function UTMTable({
  rows,
  sort,
  order,
  onSort,
  onRowClick,
}: {
  rows: UtmAnalyticsRow[];
  sort: SortField;
  order: SortOrder;
  onSort: (field: SortField) => void;
  onRowClick: (id: string) => void;
}) {
  return (
    <div className="border border-ora-sand/60 bg-ora-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-ora-sand/60 text-ora-charcoal-light">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  className={`cursor-pointer select-none px-4 pb-2 pt-3 font-medium hover:text-ora-charcoal ${
                    col.align === 'right' ? 'text-right' : ''
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <SortIcon active={sort === col.key} order={order} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick(row.id)}
                className="cursor-pointer border-b border-ora-sand/30 last:border-0 hover:bg-ora-sand/20 transition-colors"
              >
                <td className="px-4 py-2.5 text-ora-charcoal">
                  <div className="flex items-center gap-1.5 max-w-[220px]">
                    <span className="truncate" title={row.taggedUrl}>
                      {row.taggedUrl}
                    </span>
                    {row.autoRegistered && (
                      <span className="inline-flex items-center gap-0.5 shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                        <Zap className="h-2.5 w-2.5" />
                        Auto
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-ora-charcoal-light">
                  {row.utmSource}
                </td>
                <td className="px-4 py-2.5 text-ora-charcoal-light">
                  {row.utmMedium}
                </td>
                <td className="px-4 py-2.5 text-ora-charcoal-light">
                  {row.utmCampaign}
                </td>
                <td className="px-4 py-2.5 text-right text-ora-charcoal">
                  {row.totalHits.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right text-ora-charcoal">
                  {row.uniqueVisitors.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right text-ora-charcoal">
                  {row.bounceRate.toFixed(1)}%
                </td>
                <td className="px-4 py-2.5 text-right text-ora-charcoal">
                  {row.conversions.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortIcon({ active, order }: { active: boolean; order: SortOrder }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
  return order === 'asc' ? (
    <ChevronUp className="h-3 w-3" />
  ) : (
    <ChevronDown className="h-3 w-3" />
  );
}

// ── Pagination Controls ──────────────────────────────────────────────────────

function PaginationControls({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-ora-charcoal-light">
      <span>
        Showing {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–
        {Math.min(page * PAGE_SIZE, total).toLocaleString()} of{' '}
        {total.toLocaleString()} links
      </span>
      <div className="flex items-center gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="inline-flex items-center gap-1 border border-ora-sand/60 px-2.5 py-1.5 text-xs disabled:opacity-40 hover:bg-ora-sand/30 transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Previous
        </button>
        <span className="text-ora-charcoal font-medium">
          Page {page} of {totalPages}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex items-center gap-1 border border-ora-sand/60 px-2.5 py-1.5 text-xs disabled:opacity-40 hover:bg-ora-sand/30 transition-colors"
        >
          Next
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  days,
  hasFilters,
  search,
  source,
  project,
}: {
  days: DaysWindow;
  hasFilters: boolean;
  search: string;
  source: string;
  project: string;
}) {
  return (
    <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 border border-ora-sand/60 bg-ora-white">
      <BarChart3 className="h-10 w-10 stroke-1 text-ora-muted" />
      {hasFilters ? (
        <>
          <p className="text-sm text-ora-charcoal">
            No UTM links match the current filters
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ora-muted">
            {search && (
              <span className="border border-ora-sand/60 px-2 py-0.5 rounded">
                Search: &quot;{search}&quot;
              </span>
            )}
            {source && (
              <span className="border border-ora-sand/60 px-2 py-0.5 rounded">
                Source: {source}
              </span>
            )}
            {project && (
              <span className="border border-ora-sand/60 px-2 py-0.5 rounded">
                Project: {project}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-ora-charcoal">
            No UTM data available for the last {days} days
          </p>
          <p className="text-xs text-ora-muted">
            Data will appear once traffic is tracked with UTM parameters.
          </p>
        </>
      )}
    </div>
  );
}

// ── Skeleton Loading State ───────────────────────────────────────────────────

function SkeletonTable() {
  return (
    <div className="border border-ora-sand/60 bg-ora-white">
      {/* Skeleton header */}
      <div className="flex border-b border-ora-sand/60 px-4 py-3 gap-4">
        {[160, 80, 80, 100, 60, 90, 80, 80].map((w, i) => (
          <div
            key={i}
            className="h-3 animate-pulse bg-ora-sand/40 rounded"
            style={{ width: w }}
          />
        ))}
      </div>
      {/* Skeleton rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex border-b border-ora-sand/30 last:border-0 px-4 py-3 gap-4"
        >
          {[160, 80, 80, 100, 60, 90, 80, 80].map((w, j) => (
            <div
              key={j}
              className="h-3 animate-pulse bg-ora-sand/30 rounded"
              style={{ width: w }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── UTM Detail Sheet ─────────────────────────────────────────────────────────

function UTMDetailSheet({
  linkId,
  days,
  onClose,
}: {
  linkId: string;
  days: DaysWindow;
  onClose: () => void;
}) {
  const {
    data: detail,
    isLoading,
    isError,
    refetch,
  } = useQuery<UtmDetailResponse>({
    queryKey: ['utm-detail', linkId, days],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE_URL}/api/utm-analytics/${linkId}/detail?days=${days}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch detail: ${res.status}`);
      }
      const json = await res.json();
      return json.data ?? json;
    },
    retry: 1,
  });

  const isEmpty =
    detail &&
    detail.link.totalHits === 0 &&
    detail.dailyHits.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div
        className="relative w-4/5 max-w-4xl bg-ora-white shadow-xl border-l border-ora-sand/60 overflow-y-auto animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ora-sand/60 bg-ora-white px-6 py-4">
          <h2 className="text-sm font-semibold text-ora-charcoal">
            Link Detail
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-ora-muted hover:bg-ora-sand/30 hover:text-ora-charcoal transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Loading State */}
          {isLoading && <DetailSkeleton />}

          {/* Error State */}
          {isError && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <AlertCircle className="h-8 w-8 text-ora-error" />
              <p className="text-sm text-ora-charcoal">
                Performance data could not be retrieved
              </p>
              <button
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 border border-ora-sand/60 px-3 py-1.5 text-xs text-ora-charcoal hover:bg-ora-sand/30 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && !isError && isEmpty && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <BarChart3 className="h-10 w-10 stroke-1 text-ora-muted" />
              <p className="text-sm text-ora-charcoal">
                No traffic was recorded in this period
              </p>
            </div>
          )}

          {/* Content */}
          {!isLoading && !isError && detail && !isEmpty && (
            <>
              {/* Link Metadata */}
              <DetailMetadata link={detail.link} />

              {/* Metric Tiles */}
              <DetailMetricTiles
                link={detail.link}
                avgSessionDuration={detail.avgSessionDuration}
                conversionRate={detail.conversionRate}
              />

              {/* Daily Hits Chart */}
              <DailyHitsChart dailyHits={detail.dailyHits} />

              {/* Top Landing Pages */}
              <TopLandingPages pages={detail.topLandingPages} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Detail: Link Metadata ────────────────────────────────────────────────────

function DetailMetadata({ link }: { link: UtmAnalyticsRow }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-ora-charcoal-light uppercase tracking-wide">
        Link Information
      </h3>
      <div className="border border-ora-sand/60 bg-ora-sand/10 p-4 space-y-2">
        <div>
          <span className="text-[11px] text-ora-muted">Tagged URL</span>
          <p className="text-xs text-ora-charcoal break-all mt-0.5">
            {link.taggedUrl}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-ora-sand/40">
          <div>
            <span className="text-[11px] text-ora-muted">Source</span>
            <p className="text-xs text-ora-charcoal">{link.utmSource}</p>
          </div>
          <div>
            <span className="text-[11px] text-ora-muted">Medium</span>
            <p className="text-xs text-ora-charcoal">{link.utmMedium}</p>
          </div>
          <div>
            <span className="text-[11px] text-ora-muted">Campaign</span>
            <p className="text-xs text-ora-charcoal">{link.utmCampaign}</p>
          </div>
          {link.utmTerm && (
            <div>
              <span className="text-[11px] text-ora-muted">Term</span>
              <p className="text-xs text-ora-charcoal">{link.utmTerm}</p>
            </div>
          )}
          {link.utmContent && (
            <div>
              <span className="text-[11px] text-ora-muted">Content</span>
              <p className="text-xs text-ora-charcoal">{link.utmContent}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Detail: Metric Tiles ─────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function DetailMetricTiles({
  link,
  avgSessionDuration,
  conversionRate,
}: {
  link: UtmAnalyticsRow;
  avgSessionDuration: number;
  conversionRate: number;
}) {
  const tiles = [
    {
      label: 'Total Hits',
      value: link.totalHits.toLocaleString(),
      icon: MousePointerClick,
    },
    {
      label: 'Unique Visitors',
      value: link.uniqueVisitors.toLocaleString(),
      icon: Users,
    },
    {
      label: 'Bounce Rate',
      value: `${link.bounceRate.toFixed(1)}%`,
      icon: TrendingUp,
    },
    {
      label: 'Avg. Duration',
      value: formatDuration(avgSessionDuration),
      icon: Timer,
    },
    {
      label: 'Conversions',
      value: link.conversions.toLocaleString(),
      icon: Target,
    },
    {
      label: 'Conversion Rate',
      value: `${conversionRate.toFixed(1)}%`,
      icon: Target,
    },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-ora-charcoal-light uppercase tracking-wide">
        Performance
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="border border-ora-sand/60 bg-ora-white p-3"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <tile.icon className="h-3 w-3 text-ora-muted" />
              <span className="text-[11px] text-ora-muted">{tile.label}</span>
            </div>
            <p className="text-lg font-semibold text-ora-charcoal">
              {tile.value}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Detail: Daily Hits Chart ─────────────────────────────────────────────────

function DailyHitsChart({
  dailyHits,
}: {
  dailyHits: Array<{ date: string; hits: number }>;
}) {
  if (dailyHits.length === 0) return null;

  const maxHits = Math.max(...dailyHits.map((d) => d.hits), 1);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-ora-charcoal-light uppercase tracking-wide">
        Daily Hits Trend
      </h3>
      <div className="border border-ora-sand/60 bg-ora-white p-4">
        {/* Y-axis label */}
        <div className="flex items-end gap-2 h-40">
          <div className="flex flex-col justify-between h-full text-[10px] text-ora-muted py-1">
            <span>{maxHits}</span>
            <span>{Math.round(maxHits / 2)}</span>
            <span>0</span>
          </div>
          {/* Bars */}
          <div className="flex-1 flex items-end gap-[2px] h-full">
            {dailyHits.map((d) => {
              const heightPct = maxHits > 0 ? (d.hits / maxHits) * 100 : 0;
              return (
                <div
                  key={d.date}
                  className="flex-1 flex flex-col items-center justify-end h-full"
                >
                  <div
                    className="w-full bg-ora-charcoal/70 hover:bg-ora-charcoal transition-colors rounded-t-sm min-h-[1px]"
                    style={{ height: `${heightPct}%` }}
                    title={`${d.date}: ${d.hits} hits`}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {/* X-axis labels */}
        <div className="flex gap-[2px] mt-1.5 ml-8">
          {dailyHits.map((d, i) => {
            // Show label every nth item to avoid crowding
            const showLabel =
              dailyHits.length <= 14 ||
              i === 0 ||
              i === dailyHits.length - 1 ||
              i % Math.ceil(dailyHits.length / 7) === 0;
            return (
              <div key={d.date} className="flex-1 text-center">
                {showLabel && (
                  <span className="text-[9px] text-ora-muted">
                    {new Date(d.date).toLocaleDateString('en', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Detail: Top Landing Pages ────────────────────────────────────────────────

function TopLandingPages({
  pages,
}: {
  pages: Array<{ path: string; hits: number }>;
}) {
  if (pages.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-ora-charcoal-light uppercase tracking-wide">
        Top Landing Pages
      </h3>
      <div className="border border-ora-sand/60 bg-ora-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-ora-sand/60 text-ora-charcoal-light">
              <th className="px-4 py-2 text-left font-medium">Path</th>
              <th className="px-4 py-2 text-right font-medium">Hits</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr
                key={p.path}
                className="border-b border-ora-sand/30 last:border-0"
              >
                <td className="px-4 py-2 text-ora-charcoal truncate max-w-[300px]">
                  {p.path}
                </td>
                <td className="px-4 py-2 text-right text-ora-charcoal">
                  {p.hits.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Detail: Skeleton ─────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      {/* Metadata skeleton */}
      <div className="space-y-3">
        <div className="h-3 w-28 animate-pulse bg-ora-sand/40 rounded" />
        <div className="border border-ora-sand/60 p-4 space-y-3">
          <div className="h-3 w-full animate-pulse bg-ora-sand/30 rounded" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-3 w-24 animate-pulse bg-ora-sand/30 rounded" />
            ))}
          </div>
        </div>
      </div>
      {/* Tiles skeleton */}
      <div className="space-y-3">
        <div className="h-3 w-24 animate-pulse bg-ora-sand/40 rounded" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border border-ora-sand/60 p-3">
              <div className="h-2.5 w-16 animate-pulse bg-ora-sand/30 rounded mb-2" />
              <div className="h-5 w-12 animate-pulse bg-ora-sand/40 rounded" />
            </div>
          ))}
        </div>
      </div>
      {/* Chart skeleton */}
      <div className="space-y-3">
        <div className="h-3 w-28 animate-pulse bg-ora-sand/40 rounded" />
        <div className="border border-ora-sand/60 p-4">
          <div className="h-40 w-full animate-pulse bg-ora-sand/20 rounded" />
        </div>
      </div>
    </div>
  );
}
