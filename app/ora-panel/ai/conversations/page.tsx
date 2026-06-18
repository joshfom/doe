'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  MessageSquare,
  AlertCircle,
} from 'lucide-react';
import { ListSkeleton } from '@/components/ui/panel-skeletons';

const STATUS_OPTIONS = ['active', 'resolved', 'handed_off', 'abandoned'] as const;

function statusBadge(status: string) {
  switch (status) {
    case 'active': return 'bg-ora-info/10 text-ora-info';
    case 'resolved': return 'bg-ora-success/10 text-ora-success';
    case 'handed_off': return 'bg-ora-warning/10 text-ora-warning';
    case 'abandoned': return 'bg-ora-sand text-ora-charcoal-light';
    default: return 'bg-ora-sand text-ora-charcoal-light';
  }
}

export default function ConversationsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [identified, setIdentified] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ai-conversations', page, search, status, channel, dateFrom, dateTo, identified],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      if (channel) params.set('channel', channel);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (identified) params.set('identified', identified);
      return fetch(`/api/ai/conversations?${params}`).then((r) => r.json());
    },
  });

  const conversations = data?.conversations ?? data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20) || 1;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">AI Conversations</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Review and monitor AI chat conversations</p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-1 text-ora-muted" />
          <input
            type="text"
            placeholder="Search by name, phone, or message…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="h-10 w-full border border-ora-stone bg-ora-white pl-10 pr-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Channel…"
          value={channel}
          onChange={(e) => { setChannel(e.target.value); setPage(1); }}
          className="h-10 w-32 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        />
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        />
        <select
          value={identified}
          onChange={(e) => { setIdentified(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All users</option>
          <option value="true">Identified</option>
          <option value="false">Visitors</option>
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <ListSkeleton rows={3} rowClassName="rounded-none" />
      ) : conversations.length === 0 ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <MessageSquare className="mx-auto h-10 w-10 stroke-1 text-ora-muted" />
          <p className="mt-2 text-sm text-ora-muted">No conversations found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {conversations.map((conv: any) => (
            <Link
              key={conv.id}
              href={`/ora-panel/ai/conversations/${conv.id}`}
              className="flex items-center gap-4 border border-ora-sand/60 bg-ora-white p-4 hover:bg-ora-cream-light transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ora-charcoal">
                    {conv.participantName || 'Anonymous'}
                  </span>
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${statusBadge(conv.status)}`}>
                    {conv.status?.replace(/_/g, ' ')}
                  </span>
                  {conv.status === 'handed_off' && (
                    <AlertCircle className="h-4 w-4 stroke-1 text-ora-warning" />
                  )}
                  {conv.channel && (
                    <span className="inline-block px-2 py-0.5 text-[10px] font-medium bg-ora-sand/50 text-ora-charcoal-light">
                      {conv.channel}
                    </span>
                  )}
                  <span className="inline-block px-2 py-0.5 text-[10px] font-medium bg-ora-info/10 text-ora-info uppercase">
                    {conv.language}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ora-muted">
                  {conv.participantPhone || conv.participantEmail || 'No contact info'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm text-ora-charcoal">{conv.messageCount ?? '—'} messages</p>
                <p className="text-xs text-ora-muted">
                  {conv.createdAt ? new Date(conv.createdAt).toLocaleDateString() : '—'}
                </p>
              </div>
            </Link>
          ))}
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
          <span className="text-sm text-ora-muted">Page {page} of {totalPages}</span>
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
