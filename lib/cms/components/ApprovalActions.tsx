'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  useContentApprovalStatus,
  useSubmitDecision,
  useApprovalConfig,
} from '@/lib/cms/hooks/use-approvals';
import type { ContentModule, ApprovalDecisionValue } from '@/lib/cms/types';
import { CheckCircle, XCircle, MessageSquare, AlertTriangle, X } from 'lucide-react';

interface ApprovalActionsProps {
  contentId: string;
  contentModule: ContentModule;
}

interface ToastItem {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
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
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Reset justSubmitted when the query data refreshes (status changes)
  useEffect(() => {
    if (status?.request?.status !== 'pending') {
      setJustSubmitted(false);
    }
  }, [status]);

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

  const { request, decisions } = status;
  const currentStep = status.currentStep ?? 1;
  const totalSteps = status.totalSteps ?? 1;
  const chain = status.chain ?? [];
  const isPending = request.status === 'pending';
  const statusStyle = STATUS_STYLES[request.status] ?? STATUS_STYLES.pending;

  // Find the current step approver name
  const currentApprover = chain.find((c) => c.position === currentStep);

  // Check if current user has already decided
  const config = configs?.find((c) => c.contentModule === contentModule);
  const assignedApproverIds = config?.approvers.map((a) => a.userId) ?? [];

  // Check if user already submitted a decision
  const userDecisionExists = decisions.some(
    (d) => assignedApproverIds.includes(d.approverId)
  );

  // Find rejection decision(s) for prominent display
  const rejectionDecisions = decisions.filter((d) => d.decision === 'rejected');

  const handleApprove = async () => {
    try {
      await submitDecision.mutateAsync({
        id: request.id,
        decision: 'approved',
        comment: comment.trim() || undefined,
      });
      setComment('');
      setJustSubmitted(true);
      pushToast('success', 'Decision submitted successfully');
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'error' in err
          ? (err as { error: string }).error
          : 'Failed to submit decision';
      pushToast('error', message);
    }
  };

  const handleRejectClick = () => {
    setShowRejectDialog(true);
    setRejectionReason('');
  };

  const handleRejectSubmit = async () => {
    try {
      await submitDecision.mutateAsync({
        id: request.id,
        decision: 'rejected',
        comment: rejectionReason.trim(),
      });
      setRejectionReason('');
      setShowRejectDialog(false);
      setComment('');
      setJustSubmitted(true);
      pushToast('success', 'Rejection submitted successfully');
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'error' in err
          ? (err as { error: string }).error
          : 'Failed to submit decision';
      pushToast('error', message);
    }
  };

  const handleRejectCancel = () => {
    setShowRejectDialog(false);
    setRejectionReason('');
  };

  const isRejectReasonValid = rejectionReason.trim().length > 0;

  // Hide action buttons if just submitted (waiting for query refresh)
  const showActions = isPending && !justSubmitted;

  return (
    <>
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded bg-ora-charcoal px-4 py-3 text-sm text-white shadow-lg animate-in slide-in-from-bottom-2"
            >
              {t.kind === 'success' && <CheckCircle className="h-5 w-5 shrink-0 stroke-1" />}
              {t.kind === 'error' && <AlertTriangle className="h-5 w-5 shrink-0 stroke-1" />}
              <span className="flex-1">{t.text}</span>
              <button
                onClick={() => dismissToast(t.id)}
                className="ml-2 shrink-0 opacity-70 hover:opacity-100"
              >
                <X className="h-4 w-4 stroke-1" />
              </button>
            </div>
          ))}
        </div>
      )}

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
              Step {currentStep} of {totalSteps}
              {currentApprover && isPending && (
                <span className="ml-1 text-ora-muted font-normal">— {currentApprover.userName}</span>
              )}
            </span>
          </div>
          <div className="h-2 w-full bg-ora-sand/60">
            <div
              className="h-full bg-ora-gold transition-all"
              style={{ width: totalSteps > 0 ? `${((request.status === 'approved' ? totalSteps : currentStep - 1) / totalSteps) * 100}%` : '0%' }}
            />
          </div>
        </div>

        {/* Rejection Reason Display — shown prominently when request is rejected */}
        {request.status === 'rejected' && rejectionDecisions.length > 0 && (
          <div className="mb-6 border border-ora-error/30 bg-ora-error/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-ora-error" />
              <h4 className="text-sm font-semibold text-ora-error">Rejection Reason</h4>
            </div>
            {rejectionDecisions.map((d) => (
              <div key={d.id} className="mt-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-ora-charcoal">{d.approverName}</span>
                  <span className="text-xs text-ora-muted">
                    {new Date(d.createdAt).toLocaleString()}
                  </span>
                </div>
                {d.comment && (
                  <p className="mt-1 text-sm text-ora-charcoal-light">{d.comment}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Success message after submission */}
        {justSubmitted && isPending && (
          <div className="mb-6 flex items-center gap-2 border border-ora-success/30 bg-ora-success/5 p-3 text-sm text-ora-success">
            <CheckCircle className="h-4 w-4 shrink-0" />
            <span>Your decision has been recorded. The chain is advancing…</span>
          </div>
        )}

        {/* Actions — only for pending requests that haven't just been submitted */}
        {showActions && !showRejectDialog && (
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
                onClick={handleApprove}
                disabled={submitDecision.isPending}
                className="inline-flex h-9 items-center gap-1.5 bg-ora-success px-5 text-sm text-ora-white hover:bg-ora-success/90 transition-colors disabled:opacity-50"
              >
                <CheckCircle className="h-3.5 w-3.5 stroke-1" />
                Approve
              </button>
              <button
                onClick={handleRejectClick}
                disabled={submitDecision.isPending}
                className="inline-flex h-9 items-center gap-1.5 bg-ora-error px-5 text-sm text-ora-white hover:bg-ora-error/90 transition-colors disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5 stroke-1" />
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Rejection Dialog — inline modal requiring a reason */}
        {showActions && showRejectDialog && (
          <div className="mb-6 border border-ora-error/30 bg-ora-error/5 p-4">
            <div className="mb-3 flex items-center gap-2">
              <XCircle className="h-4 w-4 text-ora-error" />
              <h4 className="text-sm font-semibold text-ora-charcoal">Reject with Reason</h4>
            </div>
            <p className="mb-2 text-xs text-ora-charcoal-light">
              Please provide a reason for rejecting this content. This will be visible to the submitter.
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Explain why this content is being rejected…"
              rows={3}
              autoFocus
              className="mb-3 w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-error focus-visible:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleRejectSubmit}
                disabled={!isRejectReasonValid || submitDecision.isPending}
                className="inline-flex h-9 items-center gap-1.5 bg-ora-error px-5 text-sm text-ora-white hover:bg-ora-error/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <XCircle className="h-3.5 w-3.5 stroke-1" />
                Submit Rejection
              </button>
              <button
                onClick={handleRejectCancel}
                disabled={submitDecision.isPending}
                className="inline-flex h-9 items-center gap-1.5 border border-ora-stone bg-ora-white px-5 text-sm text-ora-charcoal hover:bg-ora-sand/30 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
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
    </>
  );
}
