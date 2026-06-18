'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  User,
  Mail,
  Phone,
  Tag,
  Zap,
  BarChart2,
  Link as LinkIcon,
  FileJson,
  MessageSquare,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { InboundLeadRow } from './useLeadsRealtime';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeadMirror {
  partyId: string;
  sfLeadId: string | null;
  stage: string | null;
  tier: 'HOT' | 'WARM' | 'NURTURE' | null;
  scoreReason: string | null;
  projectInterest: string | null;
  unitInterest: string | null;
  budgetBand: string | null;
  source: string | null;
  campaign: string | null;
  assignedRepId: string | null;
  lastInteractionAt: string | null;
  lastInteractionSummary: string | null;
}

interface SfSyncRow {
  id: string;
  status: 'pending' | 'sent' | 'dead';
  attempts: number;
  sfId: string | null;
  updatedAt: string;
}

interface LeadDetail extends InboundLeadRow {
  rawPayload: unknown;
  mirror?: LeadMirror;
  sfSync?: SfSyncRow;
}

interface SyncResult {
  ok: boolean;
  outboxId: string;
  jobKey: string;
  queued: boolean;
}

interface AnalyzeResult {
  ok: boolean;
  status: 'parsed' | 'queued';
  resolution: 'match' | 'new' | 'conflict' | 'error';
  partyId: string | null;
  repId: string | null;
  sfOutboxId: string | null;
  note?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  received: 'bg-blue-50 text-blue-700 ring-blue-200',
  parsed: 'bg-amber-50 text-amber-700 ring-amber-200',
  queued: 'bg-violet-50 text-violet-700 ring-violet-200',
  failed: 'bg-red-50 text-red-700 ring-red-200',
};

const TIER_STYLES: Record<string, string> = {
  HOT: 'bg-red-50 text-red-700 ring-red-200',
  WARM: 'bg-orange-50 text-orange-700 ring-orange-200',
  NURTURE: 'bg-sky-50 text-sky-700 ring-sky-200',
};

const SF_STATUS_STYLES: Record<string, string> = {
  pending: 'text-amber-600',
  sent: 'text-green-600',
  dead: 'text-red-600',
};

function formatFull(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function shortId(id: string): string {
  return id.slice(0, 8) + '…';
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-ora-muted" strokeWidth={1.5} />
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ora-muted">{title}</h3>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
      <span className="w-36 shrink-0 text-xs text-ora-muted">{label}</span>
      <span className="text-xs text-ora-charcoal wrap-break-word">{value ?? '—'}</span>
    </div>
  );
}

function CollapsibleJson({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-ora-charcoal-light hover:text-ora-charcoal transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {open ? 'Collapse' : 'Show raw payload'}
      </button>
      {open && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-950 p-4 text-[11px] leading-relaxed text-green-300 ring-1 ring-gray-800">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// ── Audit timeline ────────────────────────────────────────────────────────────

function AuditTimeline({ lead }: { lead: LeadDetail }) {
  const statusOrder = ['received', 'parsed', 'queued', 'failed'];
  const currentIdx = statusOrder.indexOf(lead.status);

  const steps = [
    {
      key: 'received',
      label: 'Lead ingested',
      detail: formatFull(lead.createdAt),
      done: true,
    },
    {
      key: 'parsed',
      label: 'AI parse & structure',
      detail: lead.structured
        ? 'Fields extracted from enquiry content'
        : currentIdx >= 1
          ? 'Parsed (no structured output)'
          : 'Pending — awaiting parse agent',
      done: currentIdx >= 1,
      pending: currentIdx < 1,
    },
    {
      key: 'queued',
      label: 'Routed to agent queue',
      detail: currentIdx >= 2
        ? 'Queued for qualification & assignment'
        : currentIdx === 1
          ? 'Pending routing'
          : '—',
      done: currentIdx >= 2,
      pending: currentIdx === 1,
    },
    ...(lead.status === 'failed'
      ? [
          {
            key: 'failed',
            label: 'Processing failed',
            detail: lead.lastError ?? 'Unknown error',
            done: false,
            error: true,
          },
        ]
      : []),
    ...(lead.mirror?.stage
      ? [
          {
            key: 'qualified',
            label: 'Lead qualified',
            detail: `Stage: ${lead.mirror.stage}${lead.mirror.tier ? ` · Tier: ${lead.mirror.tier}` : ''}`,
            done: true,
          },
        ]
      : []),
    ...(lead.mirror?.assignedRepId
      ? [
          {
            key: 'assigned',
            label: 'Rep assigned',
            detail: `Rep ID: ${lead.mirror.assignedRepId.slice(0, 8)}…`,
            done: true,
          },
        ]
      : []),
    ...(lead.sfSync
      ? [
          {
            key: 'sf',
            label: 'Salesforce sync',
            detail:
              lead.sfSync.status === 'sent'
                ? `Synced · SF ID: ${lead.sfSync.sfId ?? 'N/A'}`
                : lead.sfSync.status === 'pending'
                  ? `Queued (attempt ${lead.sfSync.attempts + 1})`
                  : `Failed after ${lead.sfSync.attempts} attempt(s)`,
            done: lead.sfSync.status === 'sent',
            pending: lead.sfSync.status === 'pending',
            error: lead.sfSync.status === 'dead',
          },
        ]
      : []),
  ];

  return (
    <div className="relative">
      <div className="absolute left-1.75 top-0 bottom-0 w-px bg-gray-100" />
      <div className="space-y-4">
        {steps.map((step) => (
          <div key={step.key} className="relative flex gap-3 pl-6">
            <div
              className={`absolute left-0 top-0.5 h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center ${
                step.error
                  ? 'border-red-400 bg-red-50'
                  : step.done
                    ? 'border-green-500 bg-green-50'
                    : step.pending
                      ? 'border-amber-400 bg-amber-50'
                      : 'border-gray-200 bg-white'
              }`}
            >
              {step.done && !step.error && (
                <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
              )}
              {step.error && <div className="h-1.5 w-1.5 rounded-full bg-red-400" />}
              {step.pending && <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
            </div>
            <div>
              <p className="text-xs font-medium text-ora-charcoal">{step.label}</p>
              <p className="text-[11px] text-ora-muted mt-0.5">{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
      {lead.attempts > 1 && (
        <p className="mt-3 pl-6 text-[11px] text-ora-muted">
          {lead.attempts} processing attempt{lead.attempts !== 1 ? 's' : ''} total
        </p>
      )}
    </div>
  );
}

// ── Structured / AI analysis ──────────────────────────────────────────────────

function AIAnalysis({
  lead,
  onAnalyze,
  isAnalyzing,
}: {
  lead: LeadDetail;
  onAnalyze: () => void;
  isAnalyzing: boolean;
}) {
  const structured =
    lead.structured && typeof lead.structured === 'object'
      ? (lead.structured as Record<string, unknown>)
      : null;

  const mirror = lead.mirror;

  if (!structured && !mirror) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-3 text-xs text-ora-muted ring-1 ring-gray-100">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {lead.status === 'received'
            ? 'Parse agent has not yet processed this lead.'
            : lead.status === 'failed'
              ? 'Parse failed — see Audit Trail for details.'
              : 'No structured data available.'}
        </div>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="inline-flex items-center gap-2 rounded-md bg-ora-charcoal px-4 py-2 text-xs font-medium text-white hover:bg-ora-graphite disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isAnalyzing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {isAnalyzing ? 'Analyzing…' : 'Run analysis'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {/* Qualification tier */}
      {mirror?.tier && (
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${TIER_STYLES[mirror.tier] ?? ''}`}
          >
            {mirror.tier}
          </span>
          {mirror.stage && (
            <span className="text-xs text-ora-muted">Stage: {mirror.stage}</span>
          )}
        </div>
      )}

      {mirror?.scoreReason && (
        <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
          <span className="font-medium">Score reason: </span>{mirror.scoreReason}
        </div>
      )}

      {/* Structured fields */}
      {structured &&
        Object.entries(structured).map(([k, v]) => (
          <KV
            key={k}
            label={k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
            value={String(v)}
          />
        ))}

      {/* Mirror fields */}
      {mirror?.projectInterest && <KV label="Project interest" value={mirror.projectInterest} />}
      {mirror?.unitInterest && <KV label="Unit interest" value={mirror.unitInterest} />}
      {mirror?.budgetBand && <KV label="Budget band" value={mirror.budgetBand} />}
      {mirror?.lastInteractionSummary && (
        <KV label="Last interaction" value={mirror.lastInteractionSummary} />
      )}
      {mirror?.sfLeadId && (
        <KV
          label="Salesforce Lead"
          value={
            <span className="font-mono text-[11px]">{mirror.sfLeadId}</span>
          }
        />
      )}
    </div>
  );
}

// ── Main sheet ────────────────────────────────────────────────────────────────

interface LeadDetailSheetProps {
  lead: InboundLeadRow | null;
  onClose: () => void;
}

export function LeadDetailSheet({ lead, onClose }: LeadDetailSheetProps) {
  const queryClient = useQueryClient();
  const [syncFeedback, setSyncFeedback] = useState<'idle' | 'success' | 'error'>('idle');
  const [analyzeFeedback, setAnalyzeFeedback] = useState<
    { kind: 'success' | 'error'; message: string } | null
  >(null);

  const { data, isLoading, error } = useQuery<LeadDetail>({
    queryKey: ['lead-detail', lead?.id],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/leads/inbound/${lead!.id}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to load lead: ${res.status}`);
      return res.json();
    },
    enabled: !!lead,
    staleTime: 30_000,
  });

  const syncMutation = useMutation<SyncResult, Error>({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/leads/inbound/${lead!.id}/sync-sf`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setSyncFeedback('success');
      // Refresh detail so the sfSync row appears in the audit trail.
      queryClient.invalidateQueries({ queryKey: ['lead-detail', lead?.id] });
    },
    onError: () => setSyncFeedback('error'),
  });

  const analyzeMutation = useMutation<AnalyzeResult, Error>({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/leads/inbound/${lead!.id}/analyze`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: (result) => {
      setAnalyzeFeedback({
        kind: result.ok ? 'success' : 'error',
        message: result.ok
          ? `Analyzed — ${result.resolution === 'new' ? 'new lead created' : 'matched existing lead'}${result.repId ? ', owner assigned' : ''}.`
          : (result.note ?? 'Analysis queued the lead for review.'),
      });
      // Refresh the detail (structured/mirror/audit) and the list (status).
      queryClient.invalidateQueries({ queryKey: ['lead-detail', lead?.id] });
      queryClient.invalidateQueries({ queryKey: ['leads', 'inbound'] });
    },
    onError: (err) => setAnalyzeFeedback({ kind: 'error', message: err.message }),
  });

  // Close on Escape key.
  // (keyboard listener kept lightweight — no portal needed)

  if (!lead) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className="fixed inset-y-0 right-0 z-50 flex w-[60%] min-w-120 flex-col bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Lead details"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ora-charcoal truncate">
                {lead.name || 'Unknown Lead'}
              </h2>
              <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-ora-charcoal-light">
                {lead.source}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                  STATUS_STYLES[lead.status] ?? 'bg-gray-50 text-gray-600 ring-gray-200'
                }`}
              >
                {lead.status}
              </span>
              {data?.mirror?.tier && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${TIER_STYLES[data.mirror.tier]}`}
                >
                  {data.mirror.tier}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-ora-muted font-mono">
              {shortId(lead.id)} · {formatFull(lead.createdAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-ora-muted hover:bg-gray-100 hover:text-ora-charcoal transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {isLoading && (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-ora-muted" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error.message}
            </div>
          )}

          {data && (
            <>
              {/* Contact & Identity */}
              <section>
                <SectionHeader icon={User} title="Contact" />
                <div className="rounded-lg bg-gray-50 px-4 py-2 ring-1 ring-gray-100">
                  <KV label="Name" value={data.name} />
                  <KV label="Email" value={data.email} />
                  <KV
                    label="Phone"
                    value={
                      data.phoneHash ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3 text-ora-muted" />
                          On file (hashed)
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  {data.partyId && (
                    <KV
                      label="Party"
                      value={
                        <a
                          href={`/ora-panel/ai/clients`}
                          className="inline-flex items-center gap-1 text-ora-charcoal underline underline-offset-2 hover:text-ora-graphite"
                        >
                          <LinkIcon className="h-3 w-3" />
                          <span className="font-mono text-[11px]">{shortId(data.partyId)}</span>
                        </a>
                      }
                    />
                  )}
                  <KV label="Lead ID" value={<span className="font-mono text-[11px]">{data.id}</span>} />
                  <KV label="Idempotency key" value={<span className="font-mono text-[11px]">{data.idempotencyKey}</span>} />
                  <KV label="Last updated" value={formatFull(data.updatedAt)} />
                </div>
              </section>

              {/* Enquiry */}
              <section>
                <SectionHeader icon={MessageSquare} title="Enquiry" />
                {data.content ? (
                  <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-ora-charcoal ring-1 ring-gray-100 whitespace-pre-wrap leading-relaxed">
                    {data.content}
                  </div>
                ) : (
                  <p className="text-xs text-ora-muted">No message content.</p>
                )}
              </section>

              {/* AI Analysis */}
              <section>
                <SectionHeader icon={Zap} title="AI Analysis & Qualification" />
                <AIAnalysis
                  lead={data}
                  onAnalyze={() => {
                    setAnalyzeFeedback(null);
                    analyzeMutation.mutate();
                  }}
                  isAnalyzing={analyzeMutation.isPending}
                />
              </section>

              {/* Attribution */}
              {data.attribution && Object.keys(data.attribution).length > 0 && (
                <section>
                  <SectionHeader icon={Tag} title="Attribution" />
                  <div className="rounded-lg bg-gray-50 px-4 py-2 ring-1 ring-gray-100">
                    {Object.entries(data.attribution as Record<string, string>).map(([k, v]) => (
                      <KV key={k} label={k} value={v} />
                    ))}
                  </div>
                </section>
              )}

              {/* Audit Trail */}
              <section>
                <SectionHeader icon={BarChart2} title="Audit Trail" />
                <AuditTimeline lead={data} />
              </section>

              {/* Raw Payload */}
              {data.rawPayload !== undefined && data.rawPayload !== null && (
                <section>
                  <SectionHeader icon={FileJson} title="Raw Payload" />
                  <CollapsibleJson data={data.rawPayload} />
                </section>
              )}
            </>
          )}
        </div>

        {/* ── Footer Actions ──────────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-gray-100 px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {analyzeFeedback && (
              <span
                className={`flex items-center gap-1.5 text-xs ${
                  analyzeFeedback.kind === 'success' ? 'text-green-600' : 'text-amber-600'
                }`}
              >
                {analyzeFeedback.kind === 'success' ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                {analyzeFeedback.message}
              </span>
            )}
            {!analyzeFeedback && syncFeedback === 'success' && (
              <span className="flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Sync queued — Salesforce will be updated shortly.
              </span>
            )}
            {!analyzeFeedback && syncFeedback === 'error' && (
              <span className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                {syncMutation.error?.message ?? 'Sync failed.'}
              </span>
            )}
            {!analyzeFeedback && data?.sfSync?.status === 'sent' && syncFeedback === 'idle' && (
              <span className="flex items-center gap-1.5 text-xs text-green-600">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Already synced to Salesforce
                {data.sfSync.sfId && <span className="font-mono">({data.sfSync.sfId})</span>}
              </span>
            )}
            {!analyzeFeedback && data?.sfSync?.status === 'pending' && syncFeedback === 'idle' && (
              <span className={`flex items-center gap-1.5 text-xs ${SF_STATUS_STYLES['pending']}`}>
                <Clock className="h-3.5 w-3.5" />
                SF sync pending…
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => {
                setAnalyzeFeedback(null);
                analyzeMutation.mutate();
              }}
              disabled={analyzeMutation.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-xs font-medium text-ora-charcoal ring-1 ring-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Re-run the analysis pipeline (parse, resolve, qualify, score, route)"
            >
              {analyzeMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {data?.status === 'received' ? 'Run analysis' : 'Re-analyze'}
            </button>

            <button
              type="button"
              onClick={() => {
                setSyncFeedback('idle');
                syncMutation.mutate();
              }}
              disabled={syncMutation.isPending || data?.sfSync?.status === 'sent'}
              className="inline-flex items-center gap-2 rounded-md bg-ora-charcoal px-4 py-2 text-xs font-medium text-white hover:bg-ora-graphite disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : data?.sfSync?.status === 'sent' ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <CloudUpload className="h-3.5 w-3.5" />
              )}
              {data?.sfSync?.status === 'sent' ? 'Synced to Salesforce' : 'Sync to Salesforce'}
            </button>

            {data?.sfSync && syncFeedback === 'idle' && data.sfSync.status !== 'sent' && (
              <button
                type="button"
                onClick={() => {
                  setSyncFeedback('idle');
                  syncMutation.mutate();
                }}
                disabled={syncMutation.isPending}
                className="rounded-md p-2 text-ora-muted hover:bg-gray-100 hover:text-ora-charcoal transition-colors"
                aria-label="Retry sync"
                title="Retry Salesforce sync"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
