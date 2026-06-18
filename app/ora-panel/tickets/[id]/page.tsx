'use client';

import { use, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  useTicket,
  useTransitionStatus,
  useAssignTicket,
  useAddNote,
  useUsers,
  useTicketApprovals,
  useDecideTicketApproval,
  useRequestTicketApproval,
  type TicketApprovalRecord,
  type TicketApprovalScope,
} from '@/lib/cms/hooks';
import { useProject } from '@/lib/cms/hooks/use-communities';
import { useSiteSettings } from '@/lib/cms/hooks';
import {
  ChevronRight,
  Send,
  UserCheck,
  Clock,
  Mail,
  Phone,
  Tag,
  FileText,
  Activity,
  MessageSquare,
  ArrowLeft,
} from 'lucide-react';

// ── Valid status transitions (mirrors lifecycle engine) ──────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['assigned', 'in_progress'],
  assigned: ['in_progress'],
  in_progress: ['resolved'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

// ── Styling helpers ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-ora-success/10 text-ora-success',
  assigned: 'bg-ora-info/10 text-ora-info',
  in_progress: 'bg-ora-warning/10 text-ora-warning',
  resolved: 'bg-ora-gold/10 text-ora-gold-dark',
  closed: 'bg-ora-sand text-ora-charcoal-light',
};

const PRIORITY_STYLES: Record<string, string> = {
  low: 'bg-ora-sand text-ora-charcoal-light',
  medium: 'bg-ora-info/10 text-ora-info',
  high: 'bg-ora-warning/10 text-ora-warning',
  urgent: 'bg-ora-error/10 text-ora-error',
};

const TRANSITION_BUTTON_STYLES: Record<string, string> = {
  assigned: 'bg-ora-info/10 text-ora-info hover:bg-ora-info/20',
  in_progress: 'bg-ora-warning/10 text-ora-warning hover:bg-ora-warning/20',
  resolved: 'bg-ora-gold/10 text-ora-gold-dark hover:bg-ora-gold/20',
  closed: 'bg-ora-sand text-ora-charcoal-light hover:bg-ora-sand-dark',
};

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSource(source: string): string {
  return source.charAt(0).toUpperCase() + source.slice(1);
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading } = useTicket(id);
  const { data: users } = useUsers();
  const transitionStatus = useTransitionStatus();
  const assignTicket = useAssignTicket();
  const addNote = useAddNote();
  const { data: settingsEntries } = useSiteSettings();
  const { data: project } = useProject(data?.ticket?.projectId ?? null);

  const [noteContent, setNoteContent] = useState('');
  const [activeTab, setActiveTab] = useState<'notes' | 'audit'>('notes');

  // Build user lookup map
  const userMap = useMemo(() => {
    const map = new Map<string, { name: string; email: string }>();
    if (users) {
      for (const u of users) {
        map.set(u.id, { name: u.name, email: u.email });
      }
    }
    return map;
  }, [users]);

  // Employee list for assignment dropdown
  const employeeList = users ?? [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 w-48 animate-pulse bg-ora-sand/60" />
        <div className="h-10 w-72 animate-pulse bg-ora-sand/60" />
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-48 animate-pulse bg-ora-sand/60" />
            <div className="h-64 animate-pulse bg-ora-sand/60" />
          </div>
          <div className="space-y-4">
            <div className="h-40 animate-pulse bg-ora-sand/60" />
            <div className="h-32 animate-pulse bg-ora-sand/60" />
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-ora-error">Ticket not found</p>
      </div>
    );
  }

  const { ticket, notes, auditTrail } = data;
  const validNextStatuses = VALID_TRANSITIONS[ticket.status] ?? [];

  const handleTransition = (newStatus: string) => {
    transitionStatus.mutate({ id: ticket.id, newStatus });
  };

  const handleAssign = (assigneeId: string) => {
    if (!assigneeId) return;
    assignTicket.mutate({ id: ticket.id, assigneeId });
  };

  const handleAddNote = () => {
    const trimmed = noteContent.trim();
    if (!trimmed) return;
    addNote.mutate(
      { id: ticket.id, content: trimmed, isInternal: true },
      { onSuccess: () => setNoteContent('') }
    );
  };

  const tabs = [
    { key: 'notes' as const, label: 'Notes', icon: MessageSquare, count: notes.length },
    { key: 'audit' as const, label: 'Audit Trail', icon: Activity, count: auditTrail.length },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">
          Feed
        </Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/tickets" className="hover:text-ora-charcoal transition-colors">
          Tickets
        </Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">{ticket.ticketNumber}</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/ora-panel/tickets"
              className="inline-flex h-8 w-8 items-center justify-center text-ora-muted hover:text-ora-charcoal transition-colors"
            >
              <ArrowLeft className="h-4 w-4 stroke-1" />
            </Link>
            <h1 className="text-2xl font-semibold text-ora-charcoal">{ticket.subject}</h1>
          </div>
          <div className="mt-2 ml-11 flex items-center gap-3">
            <span className="font-mono text-sm text-ora-muted">{ticket.ticketNumber}</span>
            <span
              className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${
                STATUS_STYLES[ticket.status] ?? 'bg-ora-sand text-ora-charcoal-light'
              }`}
            >
              {formatStatus(ticket.status)}
            </span>
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                PRIORITY_STYLES[ticket.priority] ?? 'bg-ora-sand text-ora-charcoal-light'
              }`}
            >
              {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
            </span>
          </div>
        </div>

        {/* Status transition buttons */}
        {validNextStatuses.length > 0 && (
          <div className="flex gap-2">
            {validNextStatuses.map((nextStatus) => (
              <button
                key={nextStatus}
                onClick={() => handleTransition(nextStatus)}
                disabled={transitionStatus.isPending}
                className={`inline-flex h-10 items-center gap-2 px-5 text-sm font-medium transition-colors disabled:opacity-50 ${
                  TRANSITION_BUTTON_STYLES[nextStatus] ?? 'bg-ora-sand text-ora-charcoal hover:bg-ora-sand-dark'
                }`}
              >
                {formatStatus(nextStatus)}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — description, notes, audit */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 stroke-1 text-ora-muted" />
              <h2 className="text-sm font-semibold text-ora-charcoal">Description</h2>
            </div>
            <p className="text-sm text-ora-charcoal-light whitespace-pre-wrap leading-relaxed">
              {ticket.description}
            </p>
          </div>

          {/* Notes / Audit tabs */}
          <div>
            <div className="mb-4 flex gap-1 border border-ora-sand bg-ora-white p-1 w-fit">
              {tabs.map(({ key, label, icon: Icon, count }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`inline-flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                    activeTab === key
                      ? 'bg-ora-charcoal text-white'
                      : 'text-ora-charcoal-light hover:bg-ora-cream-light'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 stroke-1" />
                  {label}
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-bold ${
                      activeTab === key
                        ? 'bg-ora-white/20 text-white'
                        : 'bg-ora-charcoal/10 text-inherit'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>

            {/* Notes tab */}
            {activeTab === 'notes' && (
              <div className="space-y-4">
                {/* Add note form */}
                <div className="border border-ora-sand/60 bg-ora-white p-4">
                  <label className="mb-2 block text-xs font-medium text-ora-charcoal-light">
                    Add Internal Note
                  </label>
                  <textarea
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Write a note…"
                    rows={3}
                    className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={handleAddNote}
                      disabled={!noteContent.trim() || addNote.isPending}
                      className="inline-flex h-9 items-center gap-2 bg-ora-charcoal px-5 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5 stroke-1" />
                      {addNote.isPending ? 'Sending…' : 'Add Note'}
                    </button>
                  </div>
                </div>

                {/* Note history */}
                {notes.length === 0 ? (
                  <div className="border border-ora-sand/60 bg-ora-white p-8 text-center">
                    <MessageSquare className="mx-auto mb-2 h-8 w-8 stroke-1 text-ora-muted" />
                    <p className="text-sm text-ora-muted">No notes yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {notes.map((note) => {
                      const author = userMap.get(note.authorId);
                      return (
                        <div
                          key={note.id}
                          className="border border-ora-sand/60 bg-ora-white p-4"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-medium text-ora-charcoal">
                              {author?.name ?? 'Unknown'}
                            </span>
                            <span className="text-xs text-ora-muted">
                              {formatDate(note.createdAt)}
                            </span>
                          </div>
                          <p className="text-sm text-ora-charcoal-light whitespace-pre-wrap">
                            {note.content}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Audit trail tab */}
            {activeTab === 'audit' && (
              <div>
                {auditTrail.length === 0 ? (
                  <div className="border border-ora-sand/60 bg-ora-white p-8 text-center">
                    <Activity className="mx-auto mb-2 h-8 w-8 stroke-1 text-ora-muted" />
                    <p className="text-sm text-ora-muted">No audit entries</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {auditTrail.map((entry) => {
                      const actor = entry.userId ? userMap.get(entry.userId) : null;
                      return (
                        <div
                          key={entry.id}
                          className="flex items-start gap-3 border border-ora-sand/60 bg-ora-white px-4 py-3"
                        >
                          <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 stroke-1 text-ora-muted" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-ora-charcoal">
                              {entry.summary ?? entry.action.replace(/_/g, ' ')}
                            </p>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-ora-muted">
                              <span>{actor?.name ?? 'System'}</span>
                              <span>·</span>
                              <span>{formatDate(entry.createdAt)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Assignment control */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <div className="mb-3 flex items-center gap-2">
              <UserCheck className="h-4 w-4 stroke-1 text-ora-muted" />
              <h3 className="text-sm font-semibold text-ora-charcoal">Assignee</h3>
            </div>
            <select
              value={ticket.assigneeId ?? ''}
              onChange={(e) => handleAssign(e.target.value)}
              disabled={assignTicket.isPending}
              className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none disabled:opacity-50"
            >
              <option value="">Unassigned</option>
              {employeeList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            {assignTicket.isPending && (
              <p className="mt-1 text-xs text-ora-muted">Assigning…</p>
            )}
          </div>

          {/* Contact info */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <h3 className="mb-3 text-sm font-semibold text-ora-charcoal">Contact</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-ora-charcoal-light w-16">Name</span>
                <span className="text-sm text-ora-charcoal">{ticket.contactName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 shrink-0 stroke-1 text-ora-muted" />
                <a
                  href={`mailto:${ticket.contactEmail}`}
                  className="text-sm text-ora-gold hover:text-ora-gold-dark transition-colors truncate"
                >
                  {ticket.contactEmail}
                </a>
              </div>
              {ticket.contactPhone && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5 shrink-0 stroke-1 text-ora-muted" />
                  <span className="text-sm text-ora-charcoal">{ticket.contactPhone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Approvals */}
          <TicketApprovalCard
            ticketId={ticket.id}
            requestType={ticket.requestType}
          />

          {/* Ticket details */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ora-charcoal">Request</h3>
              <Link
                href={`/ora-panel/tickets/${ticket.id}/request`}
                className="text-xs text-ora-gold hover:text-ora-gold-dark"
              >
                Edit
              </Link>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="font-medium text-ora-charcoal-light">Type</span>
                <span className="text-ora-charcoal">{ticket.requestType.replaceAll('_', ' ')}</span>
              </div>
              {ticket.unitNumber && (
                <div className="flex justify-between">
                  <span className="font-medium text-ora-charcoal-light">Unit</span>
                  <span className="font-mono text-ora-charcoal">{ticket.unitNumber}</span>
                </div>
              )}
              {ticket.scheduledStart && (
                <div className="flex justify-between">
                  <span className="font-medium text-ora-charcoal-light">Scheduled</span>
                  <span className="text-ora-charcoal">
                    {formatDate(ticket.scheduledStart)}
                    {ticket.scheduledEnd ? ` → ${formatDate(ticket.scheduledEnd)}` : ''}
                  </span>
                </div>
              )}
              {ticket.requestData && Object.keys(ticket.requestData).length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-ora-charcoal-light hover:text-ora-charcoal">
                    Structured data
                  </summary>
                  <pre className="mt-2 overflow-x-auto border border-ora-sand bg-ora-cream/40 p-2 font-mono text-[10px] text-ora-charcoal">
                    {JSON.stringify(ticket.requestData, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>

          {/* Ticket details */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <h3 className="mb-3 text-sm font-semibold text-ora-charcoal">Details</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ora-charcoal-light">Status</span>
                <span
                  className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${
                    STATUS_STYLES[ticket.status] ?? 'bg-ora-sand text-ora-charcoal-light'
                  }`}
                >
                  {formatStatus(ticket.status)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ora-charcoal-light">Priority</span>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                    PRIORITY_STYLES[ticket.priority] ?? 'bg-ora-sand text-ora-charcoal-light'
                  }`}
                >
                  {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                </span>
              </div>
              {ticket.category && (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ora-charcoal-light">Category</span>
                  <div className="flex items-center gap-1">
                    <Tag className="h-3 w-3 stroke-1 text-ora-muted" />
                    <span className="text-xs text-ora-charcoal">{ticket.category}</span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ora-charcoal-light">Source</span>
                <span className="text-xs text-ora-charcoal">{formatSource(ticket.source)}</span>
              </div>
              {project && (() => {
                const map: Record<string, string> = {};
                for (const e of settingsEntries ?? []) map[e.key] = e.value;
                const enPrefix = (map.project_slug_prefix || 'projects').trim();
                const liveHref = `/${enPrefix}/${project.slug}`;
                return (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <span className="shrink-0 text-xs font-medium text-ora-charcoal-light">Project</span>
                      <div className="flex flex-col items-end gap-1 text-right">
                        <Link
                          href={`/ora-panel/projects/${project.id}`}
                          className="text-xs text-ora-gold hover:text-ora-charcoal"
                        >
                          {project.nameEn}
                        </Link>
                        <a
                          href={liveHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] text-ora-muted hover:text-ora-charcoal"
                        >
                          {liveHref} ↗
                        </a>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>

          {/* Timestamps */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <h3 className="mb-3 text-sm font-semibold text-ora-charcoal">Dates</h3>
            <div className="space-y-3">
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 stroke-1 text-ora-muted" />
                <div>
                  <p className="text-xs font-medium text-ora-charcoal-light">Created</p>
                  <p className="text-xs text-ora-charcoal">{formatDate(ticket.createdAt)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 stroke-1 text-ora-muted" />
                <div>
                  <p className="text-xs font-medium text-ora-charcoal-light">Updated</p>
                  <p className="text-xs text-ora-charcoal">{formatDate(ticket.updatedAt)}</p>
                </div>
              </div>
              {ticket.resolvedAt && (
                <div className="flex items-start gap-2">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 stroke-1 text-ora-muted" />
                  <div>
                    <p className="text-xs font-medium text-ora-charcoal-light">Resolved</p>
                    <p className="text-xs text-ora-charcoal">{formatDate(ticket.resolvedAt)}</p>
                  </div>
                </div>
              )}
              {ticket.closedAt && (
                <div className="flex items-start gap-2">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 stroke-1 text-ora-muted" />
                  <div>
                    <p className="text-xs font-medium text-ora-charcoal-light">Closed</p>
                    <p className="text-xs text-ora-charcoal">{formatDate(ticket.closedAt)}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Approval card ────────────────────────────────────────────────────────────

const APPROVABLE_TYPES = new Set([
  'noc',
  'move_in',
  'vendor_access',
  'construction_material_delivery',
]);

const APPROVAL_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900',
  approved: 'bg-ora-success/15 text-ora-success',
  rejected: 'bg-ora-error/15 text-ora-error',
  cancelled: 'bg-ora-sand text-ora-charcoal-light',
};

function TicketApprovalCard({
  ticketId,
  requestType,
}: {
  ticketId: string;
  requestType: string;
}) {
  const { data: approvals } = useTicketApprovals(ticketId);
  const decide = useDecideTicketApproval(ticketId);
  const request = useRequestTicketApproval(ticketId);
  const [comment, setComment] = useState('');

  if (!APPROVABLE_TYPES.has(requestType)) return null;

  const current: TicketApprovalRecord | undefined = approvals?.[0];
  const isPending = current?.status === 'pending';

  return (
    <div className="border border-ora-sand/60 bg-ora-white p-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ora-charcoal">Approval</h3>
        {current && (
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
              APPROVAL_STATUS_STYLES[current.status] ?? 'bg-ora-sand text-ora-charcoal-light'
            }`}
          >
            {current.status}
          </span>
        )}
      </div>

      {!current && (
        <div className="space-y-3 text-xs">
          <p className="text-ora-charcoal-light">
            No approval has been opened for this {requestType.replaceAll('_', ' ')} yet.
          </p>
          <button
            type="button"
            disabled={request.isPending}
            onClick={() =>
              request.mutate({ scope: requestType as TicketApprovalScope })
            }
            className="rounded bg-ora-charcoal px-3 py-1.5 text-xs font-medium text-ora-cream hover:bg-ora-charcoal-light disabled:opacity-50"
          >
            {request.isPending ? 'Opening…' : 'Open approval request'}
          </button>
        </div>
      )}

      {current && (
        <div className="space-y-3 text-xs">
          <div className="flex justify-between">
            <span className="font-medium text-ora-charcoal-light">Scope</span>
            <span className="text-ora-charcoal">{current.scope.replaceAll('_', ' ')}</span>
          </div>
          {current.requestedByName && (
            <div className="flex justify-between">
              <span className="font-medium text-ora-charcoal-light">Requested by</span>
              <span className="text-ora-charcoal">{current.requestedByName}</span>
            </div>
          )}
          {current.decidedByName && (
            <div className="flex justify-between">
              <span className="font-medium text-ora-charcoal-light">Decided by</span>
              <span className="text-ora-charcoal">
                {current.decidedByName}
                {current.decidedAt ? ` · ${new Date(current.decidedAt).toLocaleString()}` : ''}
              </span>
            </div>
          )}
          {current.decisionComment && (
            <div className="space-y-1">
              <span className="block font-medium text-ora-charcoal-light">Comment</span>
              <p className="whitespace-pre-wrap rounded border border-ora-sand bg-ora-cream/40 p-2 text-ora-charcoal">
                {current.decisionComment}
              </p>
            </div>
          )}

          {isPending && (
            <div className="space-y-2 border-t border-ora-sand/60 pt-3">
              <label className="block text-xs font-medium text-ora-charcoal-light">
                Decision comment (optional)
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className="w-full rounded border border-ora-sand bg-ora-white px-2 py-1.5 text-xs focus:border-ora-gold focus:outline-none"
                placeholder="Notes for the requester…"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate({
                      approvalId: current.id,
                      decision: 'approved',
                      comment: comment.trim() || undefined,
                    })
                  }
                  className="flex-1 rounded bg-ora-success px-3 py-1.5 text-xs font-medium text-ora-white hover:opacity-90 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() =>
                    decide.mutate({
                      approvalId: current.id,
                      decision: 'rejected',
                      comment: comment.trim() || undefined,
                    })
                  }
                  className="flex-1 rounded bg-ora-error px-3 py-1.5 text-xs font-medium text-ora-white hover:opacity-90 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
              {decide.isError && (
                <p className="text-xs text-ora-error">
                  {(decide.error as Error)?.message ?? 'Failed to record decision'}
                </p>
              )}
            </div>
          )}

          {!isPending && current.status !== 'pending' && (
            <button
              type="button"
              disabled={request.isPending}
              onClick={() =>
                request.mutate({ scope: current.scope as TicketApprovalScope })
              }
              className="w-full rounded border border-ora-sand bg-ora-white px-3 py-1.5 text-xs font-medium text-ora-charcoal hover:bg-ora-cream disabled:opacity-50"
            >
              {request.isPending ? 'Reopening…' : 'Reopen approval'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
