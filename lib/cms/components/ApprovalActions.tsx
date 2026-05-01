'use client';

import { useState } from 'react';
import {
  useContentApprovalStatus,
  useSubmitDecision,
  useApprovalConfig,
} from '@/lib/cms/hooks/use-approvals';
import type { ContentModule, ApprovalDecisionValue } from '@/lib/cms/types';
import { CheckCircle, XCircle, Clock, MessageSquare } from 'lucide-react';

interface ApprovalActionsProps {
  contentId: string;
  contentModule: ContentModule;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-ora-warning/10', text: 'text-ora-warning', label: 'Pending Review' },
  approved: { bg: 'bg-ora-success/10', text: 'text-ora-success', label: 'Approved' },
  rejected: { bg: 'bg-ora-error/10', text: 'text-ora-error', label: 'Rejected' },
};

export function ApprovalActions({ contentId, contentModule }: ApprovalActionsProps) {
  const { data: status, isLoading } = useContentApprovalStatus(contentModule, contentId);
  const { data: configs } = useApprovalConfig();
  const submitDecision = useSubmitDecision();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="border border-ora-sand/60 bg-ora-white p-6">
        <div className="space-y-3">
          <div className="h-5 w-1/3 animate-pulse bg-ora-sand/60" />
          <div className="h-4 w-1/2 animate-pulse bg-ora-sand/60" />
        </div>
      </div>
    );
  }

  if (!status?.request) return null;

  const { request, approved, total, decisions } = status;
  const isPending = request.status === 'pending';
  const statusStyle = STATUS_STYLES[request.status] ?? STATUS_STYLES.pending;

  // Check if current user has already decided
  const config = configs?.find((c) => c.contentModule === contentModule);
  const assignedApproverIds = config?.approvers.map((a) => a.userId) ?? [];

  // Check if user already submitted a decision
  const userDecisionExists = decisions.some(
    (d) => assignedApproverIds.includes(d.approverId)
  );

  const handleDecision = async (decision: ApprovalDecisionValue) => {
    setError(null);
    try {
      await submitDecision.mutateAsync({
        id: request.id,
        decision,
        comment: comment.trim() || undefined,
      });
      setComment('');
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'error' in err
          ? (err as { error: string }).error
          : 'Failed to submit decision';
      setError(message);
    }
  };

  return (
    <div className="border border-ora-sand/60 bg-ora-white p-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-ora-charcoal">Approval Status</h3>
        <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
          {statusStyle.label}
        </span>
      </div>

      {/* Progress */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="text-ora-charcoal-light">Progress</span>
          <span className="font-medium text-ora-charcoal">
            {approved} of {total} approved
          </span>
        </div>
        <div className="h-2 w-full bg-ora-sand/60">
          <div
            className="h-full bg-ora-gold transition-all"
            style={{ width: total > 0 ? `${(approved / total) * 100}%` : '0%' }}
          />
        </div>
      </div>

      {/* Actions — only for pending requests */}
      {isPending && (
        <div className="mb-6">
          <label className="mb-1 block text-xs font-medium text-ora-charcoal-light">
            Comment (optional)
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add feedback for the submitter…"
            rows={2}
            className="mb-3 w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleDecision('approved')}
              disabled={submitDecision.isPending}
              className="inline-flex h-9 items-center gap-1.5 bg-ora-success px-5 text-sm text-ora-white hover:bg-ora-success/90 transition-colors disabled:opacity-50"
            >
              <CheckCircle className="h-3.5 w-3.5 stroke-1" />
              Approve
            </button>
            <button
              onClick={() => handleDecision('rejected')}
              disabled={submitDecision.isPending}
              className="inline-flex h-9 items-center gap-1.5 bg-ora-error px-5 text-sm text-ora-white hover:bg-ora-error/90 transition-colors disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5 stroke-1" />
              Reject
            </button>
          </div>
          {error && (
            <p className="mt-2 text-xs text-ora-error">{error}</p>
          )}
        </div>
      )}

      {/* Decision History Timeline */}
      {decisions.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-ora-charcoal">Decision History</h4>
          <div className="space-y-3">
            {decisions.map((d) => (
              <div key={d.id} className="relative flex gap-3 pl-4">
                <div className="absolute left-0 top-1 h-full w-px bg-ora-sand" />
                <div
                  className={`relative z-10 mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    d.decision === 'approved' ? 'bg-ora-success' : 'bg-ora-error'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ora-charcoal">
                      {d.approverName}
                    </span>
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        d.decision === 'approved'
                          ? 'bg-ora-success/10 text-ora-success'
                          : 'bg-ora-error/10 text-ora-error'
                      }`}
                    >
                      {d.decision}
                    </span>
                  </div>
                  {d.comment && (
                    <div className="mt-1 flex items-start gap-1.5">
                      <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 stroke-1 text-ora-muted" />
                      <p className="text-xs text-ora-charcoal-light">{d.comment}</p>
                    </div>
                  )}
                  <p className="mt-0.5 text-xs text-ora-muted">
                    {new Date(d.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
