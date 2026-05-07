'use client';

import { Check, X, Circle, Clock, CheckCircle } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useSubmitDecision, useDemoReopenApproval } from '@/lib/cms/hooks/use-approvals';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChainStep {
  userId: string;
  userName: string;
  position: number;
}

export interface ChainDecision {
  chainStep: number;
  approverId: string;
  approverName: string;
  decision: string;
  comment: string | null;
  createdAt: string;
}

export interface ApprovalChainStepperProps {
  chain: ChainStep[];
  decisions: ChainDecision[];
  currentStep: number;
  totalSteps: number;
  requestStatus: 'pending' | 'approved' | 'rejected';
  /** If provided, enables "Approve on behalf" buttons for the active step */
  requestId?: string;
  /** Called after a successful approval to refresh data */
  onDecisionSubmitted?: () => void;
}

// ── Step Status Helpers ──────────────────────────────────────────────────────

type StepVisualState = 'completed' | 'active' | 'future' | 'rejected' | 'skipped';

function getStepState(
  position: number,
  currentStep: number,
  requestStatus: 'pending' | 'approved' | 'rejected',
  rejectedAtStep: number | null,
  decisions: ChainDecision[]
): StepVisualState {
  // If the request is rejected, determine which step was rejected
  if (requestStatus === 'rejected' && rejectedAtStep !== null) {
    if (position < rejectedAtStep) return 'completed';
    if (position === rejectedAtStep) return 'rejected';
    return 'skipped';
  }

  // If the request is fully approved, only mark steps with actual decisions as completed
  if (requestStatus === 'approved') {
    const hasDecision = decisions.some((d) => d.chainStep === position);
    if (hasDecision) return 'completed';
    // Steps without decisions in an approved request — show as completed
    // only if they are at or below the currentStep that was reached
    if (position <= currentStep) return 'completed';
    return 'future';
  }

  // Request is pending
  if (position < currentStep) return 'completed';
  if (position === currentStep) return 'active';
  return 'future';
}

function getDecisionForStep(decisions: ChainDecision[], position: number): ChainDecision | undefined {
  return decisions.find((d) => d.chainStep === position);
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Step Icon ────────────────────────────────────────────────────────────────

function StepIcon({ state }: { state: StepVisualState }) {
  switch (state) {
    case 'completed':
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600">
          <Check className="h-4 w-4" />
        </div>
      );
    case 'active':
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ora-gold bg-ora-gold/10 text-ora-gold animate-pulse">
          <Clock className="h-4 w-4" />
        </div>
      );
    case 'rejected':
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
          <X className="h-4 w-4" />
        </div>
      );
    case 'skipped':
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ora-sand/40 text-ora-muted">
          <Circle className="h-4 w-4" />
        </div>
      );
    case 'future':
    default:
      return (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ora-sand/40 text-ora-muted">
          <Circle className="h-4 w-4" />
        </div>
      );
  }
}

// ── Connector Line ───────────────────────────────────────────────────────────

function ConnectorLine({ state }: { state: StepVisualState }) {
  const colorClass =
    state === 'completed'
      ? 'bg-green-300'
      : state === 'rejected'
        ? 'bg-red-300'
        : 'bg-ora-sand/60';

  return <div className={`ml-[15px] w-0.5 h-6 ${colorClass}`} />;
}

// ── Step Content ─────────────────────────────────────────────────────────────

function StepContent({
  step,
  state,
  decision,
}: {
  step: ChainStep;
  state: StepVisualState;
  decision: ChainDecision | undefined;
}) {
  return (
    <div className="min-w-0 flex-1">
      {/* Step header */}
      <div className="flex items-baseline gap-2">
        <span
          className={`text-xs font-medium ${
            state === 'skipped' ? 'text-ora-muted line-through' : 'text-ora-muted'
          }`}
        >
          Step {step.position}
        </span>
      </div>

      {/* Approver name */}
      <p
        className={`text-sm font-medium ${
          state === 'completed'
            ? 'text-ora-charcoal'
            : state === 'active'
              ? 'text-ora-charcoal'
              : state === 'rejected'
                ? 'text-red-700'
                : state === 'skipped'
                  ? 'text-ora-muted line-through'
                  : 'text-ora-muted'
        }`}
      >
        {decision ? decision.approverName : step.userName}
      </p>

      {/* Decision details for completed steps */}
      {state === 'completed' && decision && (
        <div className="mt-1 space-y-0.5">
          <p className="text-xs text-ora-muted">
            Approved {formatTimestamp(decision.createdAt)}
          </p>
          {decision.comment && (
            <p className="text-xs text-ora-charcoal-light italic">
              &ldquo;{decision.comment}&rdquo;
            </p>
          )}
        </div>
      )}

      {/* Decision details for rejected step */}
      {state === 'rejected' && decision && (
        <div className="mt-1 space-y-0.5">
          <p className="text-xs text-red-600">
            Rejected by {decision.approverName} &middot; {formatTimestamp(decision.createdAt)}
          </p>
          {decision.comment && (
            <p className="text-xs text-red-600/80 italic">
              Reason: &ldquo;{decision.comment}&rdquo;
            </p>
          )}
        </div>
      )}

      {/* Active step indicator */}
      {state === 'active' && (
        <p className="mt-0.5 text-xs text-ora-gold">
          Awaiting review
        </p>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ApprovalChainStepper({
  chain,
  decisions,
  currentStep,
  totalSteps,
  requestStatus,
  requestId,
  onDecisionSubmitted,
}: ApprovalChainStepperProps) {
  const submitDecision = useSubmitDecision();
  const reopenDemo = useDemoReopenApproval();
  const [approvingStep, setApprovingStep] = useState<number | null>(null);

  // Determine which step was rejected (if any)
  const rejectionDecision = decisions.find((d) => d.decision === 'rejected');
  const rejectedAtStep = rejectionDecision ? rejectionDecision.chainStep : null;

  // Sort chain by position
  const sortedChain = [...chain].sort((a, b) => a.position - b.position);

  const handleApproveOnBehalf = useCallback(async (step: ChainStep) => {
    if (!requestId) return;
    setApprovingStep(step.position);
    try {
      // Demo: if the request is already resolved (approved/rejected) but the
      // chain has more steps without decisions, reopen it first so the
      // presenter can re-run the flow from any approver to publish.
      let liveCurrentStep = currentStep;
      if (requestStatus !== 'pending') {
        const reopened = await reopenDemo.mutateAsync(requestId);
        liveCurrentStep = reopened.currentStep;
      }

      // Sequentially approve every step from the live current step up to
      // and including the clicked step (skipping any already-decided steps).
      const stepsToApprove = sortedChain.filter(
        (s) =>
          s.position >= liveCurrentStep &&
          s.position <= step.position &&
          !decisions.some((d) => d.chainStep === s.position)
      );
      for (const s of stepsToApprove) {
        setApprovingStep(s.position);
        await submitDecision.mutateAsync({
          id: requestId,
          decision: 'approved',
          comment: `Approved on behalf of ${s.userName} (demo)`,
        });
      }
      onDecisionSubmitted?.();
    } catch {
      // Toast will handle errors from the mutation
    } finally {
      setApprovingStep(null);
    }
  }, [requestId, submitDecision, reopenDemo, onDecisionSubmitted, sortedChain, currentStep, requestStatus, decisions]);

  return (
    <div className="space-y-0" role="list" aria-label="Approval chain progress">
      {sortedChain.map((step, index) => {
        const state = getStepState(step.position, currentStep, requestStatus, rejectedAtStep, decisions);
        const decision = getDecisionForStep(decisions, step.position);
        const isActiveStep = state === 'active' && requestStatus === 'pending';
        // Demo: allow approving on behalf for any step that doesn't yet have
        // a decision recorded — even if the overall request is already
        // resolved (we'll reopen it on click).
        const canApproveOnBehalf =
          !!requestId && !decision && state !== 'rejected' && state !== 'skipped';

        return (
          <div key={step.userId} role="listitem">
            {/* Step row */}
            <div className="flex items-start gap-3">
              <StepIcon state={state} />
              <div className="min-w-0 flex-1">
                <StepContent step={step} state={state} decision={decision} />
                {/* Approve on behalf button — enabled for active and future
                    pending steps (demo: clicking any future step approves all
                    intervening steps in sequence). */}
                {canApproveOnBehalf && (
                  <button
                    onClick={() => handleApproveOnBehalf(step)}
                    disabled={approvingStep !== null}
                    className={`mt-2 inline-flex h-8 items-center gap-1.5 px-4 text-xs text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                      state === 'active'
                        ? 'bg-ora-success hover:bg-ora-success/90'
                        : 'bg-ora-muted hover:bg-ora-muted/80'
                    }`}
                  >
                    <CheckCircle className="h-3.5 w-3.5 stroke-1" />
                    {approvingStep === step.position
                      ? 'Approving…'
                      : `Approve on behalf of ${step.userName}`}
                  </button>
                )}
              </div>
            </div>

            {/* Connector line between steps */}
            {index < sortedChain.length - 1 && (
              <ConnectorLine state={state} />
            )}
          </div>
        );
      })}
    </div>
  );
}
