'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, User, Bot, AlertTriangle } from 'lucide-react';

function roleBadge(role: string) {
  switch (role) {
    case 'user': return { icon: User, cls: 'bg-ora-cream border-ora-sand' };
    case 'assistant': return { icon: Bot, cls: 'bg-ora-gold/5 border-ora-gold/20' };
    case 'system': return { icon: AlertTriangle, cls: 'bg-ora-warning/5 border-ora-warning/20' };
    default: return { icon: User, cls: 'bg-ora-cream border-ora-sand' };
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'active': return 'bg-ora-info/10 text-ora-info';
    case 'resolved': return 'bg-ora-success/10 text-ora-success';
    case 'handed_off': return 'bg-ora-warning/10 text-ora-warning';
    case 'abandoned': return 'bg-ora-sand text-ora-charcoal-light';
    default: return 'bg-ora-sand text-ora-charcoal-light';
  }
}

export default function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, isLoading } = useQuery({
    queryKey: ['ai-conversation', id],
    queryFn: () => fetch(`/api/ai/conversations/${id}`).then((r) => r.json()),
  });

  const conv = data?.conversation ?? data;
  const messages = conv?.messages ?? data?.messages ?? [];

  if (isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><p className="text-sm text-ora-muted">Loading…</p></div>;
  }

  if (!conv) {
    return <div className="flex min-h-[40vh] items-center justify-center"><p className="text-sm text-ora-error">Conversation not found</p></div>;
  }

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/ai/conversations" className="hover:text-ora-charcoal transition-colors">AI Conversations</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">Conversation</span>
      </nav>

      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-ora-charcoal">
            {conv.participantName || 'Anonymous'}
          </h1>
          <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${statusBadge(conv.status)}`}>
            {conv.status?.replace(/_/g, ' ')}
          </span>
        </div>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          {conv.participantPhone || conv.participantEmail || 'No contact info'}
          {conv.channel && ` · ${conv.channel}`}
          {conv.language && ` · ${conv.language.toUpperCase()}`}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Messages */}
        <div className="lg:col-span-2 space-y-3">
          {messages.length === 0 ? (
            <div className="border border-ora-sand/60 bg-ora-white p-8 text-center">
              <p className="text-sm text-ora-muted">No messages</p>
            </div>
          ) : (
            messages.map((msg: any, i: number) => {
              const badge = roleBadge(msg.role);
              const Icon = badge.icon;
              return (
                <div key={msg.id ?? i} className={`border p-4 ${badge.cls}`}>
                  <div className="mb-2 flex items-center gap-2">
                    <Icon className="h-4 w-4 stroke-1 text-ora-charcoal-light" />
                    <span className="text-xs font-medium text-ora-charcoal uppercase">{msg.role}</span>
                    <span className="text-xs text-ora-muted">
                      {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : ''}
                    </span>
                  </div>
                  <p className="text-sm text-ora-charcoal whitespace-pre-wrap">{msg.content}</p>
                  {msg.metadata && Object.keys(msg.metadata).length > 0 && (
                    <div className="mt-2 border-t border-ora-sand/40 pt-2">
                      <p className="text-[10px] uppercase tracking-widest font-bold text-ora-muted mb-1">Metadata</p>
                      <pre className="text-xs text-ora-muted font-mono overflow-x-auto">
                        {JSON.stringify(msg.metadata, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Sidebar — Metadata */}
        <div className="space-y-6">
          <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-3">
            <h3 className="text-sm font-semibold text-ora-charcoal">Conversation Info</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ora-charcoal-light">Status</span>
                <span className="text-ora-charcoal font-medium">{conv.status?.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ora-charcoal-light">Participant</span>
                <span className="text-ora-charcoal">{conv.participantName || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ora-charcoal-light">Type</span>
                <span className="text-ora-charcoal">{conv.participantType || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ora-charcoal-light">Language</span>
                <span className="text-ora-charcoal uppercase">{conv.language || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ora-charcoal-light">Channel</span>
                <span className="text-ora-charcoal">{conv.channel || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ora-charcoal-light">Created</span>
                <span className="text-ora-charcoal">{conv.createdAt ? new Date(conv.createdAt).toLocaleString() : '—'}</span>
              </div>
              {conv.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-ora-charcoal-light">Resolved</span>
                  <span className="text-ora-charcoal">{new Date(conv.resolvedAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          {/* Handoff Summary */}
          {conv.status === 'handed_off' && conv.handoffSummary && (
            <div className="border border-ora-warning/30 bg-ora-warning/5 p-6 space-y-2">
              <h3 className="text-sm font-semibold text-ora-warning">Handoff Summary</h3>
              <pre className="text-xs text-ora-charcoal-light font-mono whitespace-pre-wrap overflow-x-auto">
                {typeof conv.handoffSummary === 'string'
                  ? conv.handoffSummary
                  : JSON.stringify(conv.handoffSummary, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
