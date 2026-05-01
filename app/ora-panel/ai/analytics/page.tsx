'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, MessageSquare, ArrowRightLeft, Hash, BookOpen, RefreshCw } from 'lucide-react';

function statusBadge(status: string) {
  switch (status) {
    case 'active': return 'bg-ora-info/10 text-ora-info';
    case 'resolved': return 'bg-ora-success/10 text-ora-success';
    case 'handed_off': return 'bg-ora-warning/10 text-ora-warning';
    case 'abandoned': return 'bg-ora-sand text-ora-charcoal-light';
    default: return 'bg-ora-sand text-ora-charcoal-light';
  }
}

export default function AnalyticsPage() {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['ai-analytics'],
    queryFn: () => fetch('/api/ai/analytics').then((r) => r.json()),
  });

  const { data: kbHealth, isLoading: kbLoading } = useQuery({
    queryKey: ['ai-analytics-kb'],
    queryFn: () => fetch('/api/ai/analytics/knowledge-base').then((r) => r.json()),
  });

  const totalConversations = stats?.totalConversations ?? 0;
  const handoffRate = stats?.handoffRate != null ? `${(stats.handoffRate * 100).toFixed(1)}%` : '—';
  const avgMessages = stats?.averageMessages != null ? stats.averageMessages.toFixed(1) : '—';
  const byStatus = stats?.byStatus ?? [];
  const dailyVolume = stats?.dailyVolume ?? [];

  const totalDocs = kbHealth?.totalDocuments ?? 0;
  const bySource = kbHealth?.bySourceType ?? [];
  const lastSync = kbHealth?.lastSyncTimestamp;
  const staleDocs = kbHealth?.staleDocuments ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">AI Analytics</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Monitor AI assistant performance and usage</p>
      </div>

      {/* Stats Cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-ora-sand/60 bg-ora-white p-6">
          <div className="flex items-center gap-3 mb-3">
            <MessageSquare className="h-5 w-5 stroke-1 text-ora-gold" />
            <span className="text-xs font-medium text-ora-charcoal-light">Total Conversations</span>
          </div>
          {statsLoading ? (
            <div className="h-8 w-20 animate-pulse bg-ora-sand/60" />
          ) : (
            <p className="text-2xl font-semibold text-ora-charcoal">{totalConversations}</p>
          )}
        </div>
        <div className="border border-ora-sand/60 bg-ora-white p-6">
          <div className="flex items-center gap-3 mb-3">
            <ArrowRightLeft className="h-5 w-5 stroke-1 text-ora-warning" />
            <span className="text-xs font-medium text-ora-charcoal-light">Handoff Rate</span>
          </div>
          {statsLoading ? (
            <div className="h-8 w-20 animate-pulse bg-ora-sand/60" />
          ) : (
            <p className="text-2xl font-semibold text-ora-charcoal">{handoffRate}</p>
          )}
        </div>
        <div className="border border-ora-sand/60 bg-ora-white p-6">
          <div className="flex items-center gap-3 mb-3">
            <Hash className="h-5 w-5 stroke-1 text-ora-info" />
            <span className="text-xs font-medium text-ora-charcoal-light">Avg Messages / Conv</span>
          </div>
          {statsLoading ? (
            <div className="h-8 w-20 animate-pulse bg-ora-sand/60" />
          ) : (
            <p className="text-2xl font-semibold text-ora-charcoal">{avgMessages}</p>
          )}
        </div>
        <div className="border border-ora-sand/60 bg-ora-white p-6">
          <div className="flex items-center gap-3 mb-3">
            <BookOpen className="h-5 w-5 stroke-1 text-ora-success" />
            <span className="text-xs font-medium text-ora-charcoal-light">KB Documents</span>
          </div>
          {kbLoading ? (
            <div className="h-8 w-20 animate-pulse bg-ora-sand/60" />
          ) : (
            <p className="text-2xl font-semibold text-ora-charcoal">{totalDocs}</p>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Conversations by Status */}
        <div className="border border-ora-sand/60 bg-ora-white p-6">
          <h3 className="text-sm font-semibold text-ora-charcoal mb-4">Conversations by Status</h3>
          {statsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse bg-ora-sand/60" />)}
            </div>
          ) : byStatus.length === 0 ? (
            <p className="text-sm text-ora-muted">No data</p>
          ) : (
            <div className="space-y-3">
              {byStatus.map((item: any) => {
                const maxCount = Math.max(...byStatus.map((s: any) => s.count || 0), 1);
                const pct = ((item.count || 0) / maxCount) * 100;
                return (
                  <div key={item.status}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${statusBadge(item.status)}`}>
                        {item.status?.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm font-medium text-ora-charcoal">{item.count}</span>
                    </div>
                    <div className="h-2 bg-ora-sand/40">
                      <div className="h-full bg-ora-gold transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Daily Volume */}
        <div className="border border-ora-sand/60 bg-ora-white p-6">
          <h3 className="text-sm font-semibold text-ora-charcoal mb-4">Daily Conversation Volume</h3>
          {statsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-6 animate-pulse bg-ora-sand/60" />)}
            </div>
          ) : dailyVolume.length === 0 ? (
            <p className="text-sm text-ora-muted">No data</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {dailyVolume.map((item: any) => (
                <div key={item.date} className="flex items-center justify-between py-1 border-b border-ora-sand/30 last:border-0">
                  <span className="text-xs text-ora-charcoal-light">{item.date}</span>
                  <span className="text-sm font-medium text-ora-charcoal">{item.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* KB Health */}
        <div className="border border-ora-sand/60 bg-ora-white p-6">
          <h3 className="text-sm font-semibold text-ora-charcoal mb-4">Knowledge Base Health</h3>
          {kbLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-6 animate-pulse bg-ora-sand/60" />)}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ora-charcoal-light">Total Documents</span>
                <span className="text-sm font-medium text-ora-charcoal">{totalDocs}</span>
              </div>
              {bySource.map((item: any) => (
                <div key={item.sourceType} className="flex items-center justify-between">
                  <span className="text-sm text-ora-charcoal-light">{item.sourceType?.replace(/_/g, ' ')}</span>
                  <span className="text-sm font-medium text-ora-charcoal">{item.count}</span>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span className="text-sm text-ora-charcoal-light">Last Sync</span>
                <span className="text-sm text-ora-charcoal">
                  {lastSync ? new Date(lastSync).toLocaleString() : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ora-charcoal-light">Stale Documents</span>
                <span className={`text-sm font-medium ${staleDocs > 0 ? 'text-ora-warning' : 'text-ora-success'}`}>
                  {staleDocs}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
