'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  usePendingTicketApprovals,
  useDecideTicketApproval,
  useCancelTicketApproval,
  type TicketApprovalRecord,
  type TicketApprovalScope,
} from '@/lib/cms/hooks';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { ListSkeleton } from '@/components/ui/panel-skeletons';

const SCOPE_LABELS: Record<TicketApprovalScope, string> = {
  noc: 'NOC',
  move_in: 'Move-in',
  vendor_access: 'Vendor access',
  construction_material_delivery: 'Construction delivery',
};

const SCOPE_FILTERS: { value: TicketApprovalScope | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'noc', label: 'NOC' },
  { value: 'move_in', label: 'Move-in' },
  { value: 'vendor_access', label: 'Vendor access' },
  { value: 'construction_material_delivery', label: 'Construction' },
];

function formatDate(input: string | Date | null) {
  if (!input) return '—';
  return new Date(input).toLocaleString();
}

export default function PendingApprovalsPage() {
  const [scope, setScope] = useState<TicketApprovalScope | 'all'>('all');
  const { data: approvals, isLoading, isError } = usePendingTicketApprovals(
    scope === 'all' ? undefined : scope
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link
            href="/ora-panel/tickets"
            className="mb-2 inline-flex items-center gap-1.5 text-xs text-ora-charcoal-light hover:text-ora-charcoal"
          >
            <ArrowLeft className="h-3.5 w-3.5 stroke-1" />
            Tickets
          </Link>
          <h1 className="text-2xl font-semibold text-ora-charcoal">
            Pending approvals
          </h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Review and act on ticket-based requests requiring manager sign-off.
          </p>
        </div>
      </div>

      {/* Scope filter */}
      <div className="mb-6 flex flex-wrap gap-2">
        {SCOPE_FILTERS.map((f) => {
          const active = scope === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setScope(f.value)}
              className={`inline-flex h-9 items-center px-4 text-xs font-medium transition-colors ${
                active
                  ? 'bg-ora-charcoal text-ora-white'
                  : 'border border-ora-sand bg-ora-white text-ora-charcoal hover:bg-ora-cream'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* List */}
      {isLoading && <ListSkeleton rows={3} rowClassName="h-28" />}
      {isError && (
        <div className="border border-ora-error/30 bg-ora-error/5 p-6 text-sm text-ora-error">
          Failed to load approvals.
        </div>
      )}
      {approvals && approvals.length === 0 && (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center text-sm text-ora-charcoal-light">
          No pending approvals.
        </div>
      )}
      {approvals && approvals.length > 0 && (
        <div className="space-y-3">
          {approvals.map((a) => (
            <ApprovalRow key={a.id} approval={a} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single row ──────────────────────────────────────────────────────────────

function ApprovalRow({ approval }: { approval: TicketApprovalRecord }) {
  const [comment, setComment] = useState('');
  const [expanded, setExpanded] = useState(false);
  const decide = useDecideTicketApproval(approval.ticketId);
  const cancel = useCancelTicketApproval(approval.ticketId);

  const busy = decide.isPending || cancel.isPending;

  return (
    <div className="border border-ora-sand/60 bg-ora-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              {SCOPE_LABELS[approval.scope] ?? approval.scope}
            </span>
            <Link
              href={`/ora-panel/tickets/${approval.ticketId}`}
              className="font-mono text-xs text-ora-gold hover:text-ora-gold-dark"
            >
              {approval.ticketId.slice(0, 8)}…
            </Link>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-ora-charcoal-light sm:grid-cols-2">
            <div>
              <span className="font-medium">Requested by:</span>{' '}
              <span className="text-ora-charcoal">
                {approval.requestedByName ?? '—'}
              </span>
            </div>
            <div>
              <span className="font-medium">Opened:</span>{' '}
              <span className="text-ora-charcoal">
                {formatDate(approval.createdAt)}
              </span>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex h-9 items-center gap-2 border border-ora-sand bg-ora-white px-4 text-xs text-ora-charcoal hover:bg-ora-cream"
        >
          {expanded ? 'Hide' : 'Decide'}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-ora-sand/60 pt-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">
              Decision comment (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={2000}
              className="w-full border border-ora-sand bg-ora-white px-2 py-1.5 text-xs focus:border-ora-gold focus:outline-none"
              placeholder="Notes for the requester or audit trail…"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                decide.mutate({
                  approvalId: approval.id,
                  decision: 'approved',
                  comment: comment.trim() || undefined,
                })
              }
              className="inline-flex h-9 items-center gap-2 bg-ora-success px-4 text-xs font-medium text-ora-white hover:opacity-90 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5 stroke-1.5" />
              Approve
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                decide.mutate({
                  approvalId: approval.id,
                  decision: 'rejected',
                  comment: comment.trim() || undefined,
                })
              }
              className="inline-flex h-9 items-center gap-2 bg-ora-error px-4 text-xs font-medium text-ora-white hover:opacity-90 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5 stroke-1.5" />
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                cancel.mutate({
                  approvalId: approval.id,
                  reason: comment.trim() || undefined,
                })
              }
              className="inline-flex h-9 items-center border border-ora-sand bg-ora-white px-4 text-xs text-ora-charcoal-light hover:bg-ora-cream disabled:opacity-50"
            >
              Cancel approval
            </button>
            <Link
              href={`/ora-panel/tickets/${approval.ticketId}`}
              className="ml-auto inline-flex h-9 items-center text-xs text-ora-gold hover:text-ora-gold-dark"
            >
              Open ticket →
            </Link>
          </div>
          {(decide.isError || cancel.isError) && (
            <p className="text-xs text-ora-error">
              {((decide.error ?? cancel.error) as Error)?.message ??
                'Action failed'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
