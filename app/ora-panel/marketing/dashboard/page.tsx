'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Bot,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  Target,
} from 'lucide-react';
import type { SessionData } from '@/lib/types/session';
import {
  PageHeaderSkeleton,
  StatCardsSkeleton,
} from '@/components/ui/panel-skeletons';
import { Skeleton } from '@/components/ui/skeleton';

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const REFRESH_INTERVAL = 300_000; // 5 minutes

// ── Types ────────────────────────────────────────────────────────────────────

interface CampaignMetric {
  campaignId: string;
  channel: string;
  spend: string;
  conversions: number;
  roas: string;
}

interface ConversionGoalBreakdown {
  goalId: string;
  eventName: string;
  displayLabel: string;
  conversions: number;
  value: number;
}

interface DashboardData {
  topCampaigns: CampaignMetric[];
  conversionBreakdown?: ConversionGoalBreakdown[];
  conversionRate: string;
  cac: string;
  roas: string;
  aiContribution: string;
  aiConversions: number;
  totalConversions: number;
  totalSpend: string;
  totalVisitors: number;
  days: number;
  fetchedAt: string;
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function MarketingDashboardPage() {
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
          router.replace('/ora-panel');
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
      <div className="mx-auto max-w-6xl">
        <PageHeaderSkeleton />
        <StatCardsSkeleton count={4} />
        <Skeleton className="mt-4 h-64 w-full" />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <ShieldAlert className="h-8 w-8 text-ora-error" />
        <p className="text-sm text-ora-charcoal">
          You do not have permission to view the marketing dashboard.
        </p>
      </div>
    );
  }

  return <DashboardContent />;
}

// ── Dashboard Content ────────────────────────────────────────────────────────

function DashboardContent() {
  const [days, setDays] = useState<7 | 30>(30);
  const lastGoodDataRef = useRef<DashboardData | null>(null);

  const {
    data: response,
    isLoading,
    isError,
    error,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['marketing-dashboard', days],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE_URL}/api/marketing-dashboard?days=${days}`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch dashboard data: ${res.status}`);
      }
      const json = await res.json();
      return json.data as DashboardData;
    },
    refetchInterval: REFRESH_INTERVAL,
    retry: 2,
  });

  // Cache last successful response
  if (response) {
    lastGoodDataRef.current = response;
  }

  const dashboardData = response || lastGoodDataRef.current;
  const isEmpty =
    dashboardData &&
    dashboardData.topCampaigns.length === 0 &&
    dashboardData.totalConversions === 0 &&
    parseFloat(dashboardData.totalSpend) === 0;

  return (
    <div className="mx-auto max-w-6xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">
            Marketing Dashboard
          </h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            ROAS, CAC, and attribution metrics
          </p>
        </div>

        {/* Time range toggle + updated timestamp */}
        <div className="flex items-center gap-4">
          <TimeRangeToggle days={days} onChange={setDays} />
          <UpdatedAgo timestamp={dataUpdatedAt} />
        </div>
      </div>

      {/* Error banner */}
      {isError && dashboardData && (
        <div className="mb-4 flex items-center gap-2 border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">
            Data source temporarily unavailable. Showing last successful data from{' '}
            {dashboardData.fetchedAt
              ? new Date(dashboardData.fetchedAt).toLocaleString('en-GB', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'earlier'}
            .
          </p>
        </div>
      )}

      {/* Loading state */}
      {isLoading && !dashboardData && (
        <div className="space-y-4">
          <StatCardsSkeleton count={4} />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {/* Error state with no cached data */}
      {isError && !dashboardData && (
        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3">
          <AlertTriangle className="h-8 w-8 text-ora-error" />
          <p className="text-sm text-ora-charcoal">
            Failed to load dashboard data.
          </p>
          <p className="text-xs text-ora-muted">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && isEmpty && (
        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 border border-ora-sand/60 bg-ora-white">
          <BarChart3 className="h-10 w-10 stroke-1 text-ora-muted" />
          <p className="text-sm text-ora-charcoal">
            No attribution data available for the last {days} days
          </p>
          <p className="text-xs text-ora-muted">
            Data will appear once ad spend is ingested and conversions are tracked.
          </p>
        </div>
      )}

      {/* Dashboard tiles */}
      {dashboardData && !isEmpty && (
        <>
          {/* Metric tiles */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
              label="Conversion Rate"
              value={`${dashboardData.conversionRate}%`}
              subtitle={`${dashboardData.totalConversions} conversions / ${dashboardData.totalVisitors.toLocaleString()} visitors`}
            />
            <MetricTile
              icon={<DollarSign className="h-5 w-5 text-blue-600" />}
              label="CAC"
              value={`AED ${dashboardData.cac}`}
              subtitle={`Total spend: AED ${parseFloat(dashboardData.totalSpend).toLocaleString()}`}
            />
            <MetricTile
              icon={<BarChart3 className="h-5 w-5 text-purple-600" />}
              label="ROAS"
              value={`${dashboardData.roas}x`}
              subtitle="Return on ad spend"
            />
            <MetricTile
              icon={<Bot className="h-5 w-5 text-ora-gold" />}
              label="AI Contribution"
              value={`${dashboardData.aiContribution}%`}
              subtitle={`${dashboardData.aiConversions} AI-attributed conversions`}
            />
          </div>

          {/* Top 10 campaigns table */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">
              Top 10 Campaigns by Spend
            </h2>
            {dashboardData.topCampaigns.length === 0 ? (
              <p className="py-4 text-center text-sm text-ora-muted">
                No campaign data for this period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-ora-sand/60 text-ora-charcoal-light">
                      <th className="pb-2 pr-4 font-medium">Campaign</th>
                      <th className="pb-2 pr-4 font-medium">Channel</th>
                      <th className="pb-2 pr-4 text-right font-medium">Spend</th>
                      <th className="pb-2 pr-4 text-right font-medium">
                        Conversions
                      </th>
                      <th className="pb-2 text-right font-medium">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardData.topCampaigns.map((campaign) => (
                      <tr
                        key={`${campaign.campaignId}-${campaign.channel}`}
                        className="border-b border-ora-sand/30 last:border-0"
                      >
                        <td className="py-2.5 pr-4 font-medium text-ora-charcoal">
                          {campaign.campaignId}
                        </td>
                        <td className="py-2.5 pr-4 text-ora-charcoal-light capitalize">
                          {campaign.channel}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-ora-charcoal">
                          AED {parseFloat(campaign.spend).toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-ora-charcoal">
                          {campaign.conversions}
                        </td>
                        <td className="py-2.5 text-right font-medium text-ora-charcoal">
                          {campaign.roas}x
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Conversions by Goal */}
          {dashboardData.conversionBreakdown &&
            dashboardData.conversionBreakdown.length > 0 && (
              <div className="mt-6 border border-ora-sand/60 bg-ora-white p-6">
                <div className="mb-4 flex items-center gap-2">
                  <Target className="h-4 w-4 text-emerald-600" />
                  <h2 className="text-sm font-semibold text-ora-charcoal">
                    Conversions by Goal
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-ora-sand/60 text-ora-charcoal-light">
                        <th className="pb-2 pr-4 font-medium">Goal</th>
                        <th className="pb-2 pr-4 font-medium">Event</th>
                        <th className="pb-2 pr-4 text-right font-medium">
                          Conversions
                        </th>
                        <th className="pb-2 text-right font-medium">Value (AED)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboardData.conversionBreakdown.map((goal) => (
                        <tr
                          key={goal.goalId || goal.eventName}
                          className="border-b border-ora-sand/30 last:border-0"
                        >
                          <td className="py-2.5 pr-4 font-medium text-ora-charcoal">
                            {goal.displayLabel || goal.eventName}
                          </td>
                          <td className="py-2.5 pr-4 text-ora-charcoal-light">
                            {goal.eventName}
                          </td>
                          <td className="py-2.5 pr-4 text-right text-ora-charcoal">
                            {goal.conversions}
                          </td>
                          <td className="py-2.5 text-right text-ora-charcoal">
                            {goal.value.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
        </>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function TimeRangeToggle({
  days,
  onChange,
}: {
  days: 7 | 30;
  onChange: (days: 7 | 30) => void;
}) {
  return (
    <div className="inline-flex border border-ora-stone">
      <button
        onClick={() => onChange(7)}
        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
          days === 7
            ? 'bg-ora-charcoal text-ora-white'
            : 'bg-ora-white text-ora-charcoal hover:bg-ora-sand/30'
        }`}
      >
        7 days
      </button>
      <button
        onClick={() => onChange(30)}
        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
          days === 30
            ? 'bg-ora-charcoal text-ora-white'
            : 'bg-ora-white text-ora-charcoal hover:bg-ora-sand/30'
        }`}
      >
        30 days
      </button>
    </div>
  );
}

function UpdatedAgo({ timestamp }: { timestamp: number }) {
  const [, setTick] = useState(0);

  // Re-render every 30 seconds to update the relative time
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (!timestamp) return null;

  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);

  let label: string;
  if (seconds < 60) {
    label = 'just now';
  } else if (minutes === 1) {
    label = '1 minute ago';
  } else {
    label = `${minutes} minutes ago`;
  }

  return (
    <span className="flex items-center gap-1.5 text-[11px] text-ora-muted">
      <RefreshCw className="h-3 w-3" />
      Updated {label}
    </span>
  );
}

function MetricTile({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="border border-ora-sand/60 bg-ora-white p-5">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-ora-charcoal-light">
          {label}
        </span>
      </div>
      <p className="text-xl font-semibold text-ora-charcoal">{value}</p>
      <p className="mt-1 text-[11px] text-ora-muted">{subtitle}</p>
    </div>
  );
}
