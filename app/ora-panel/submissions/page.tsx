'use client';

import { useState, useMemo } from 'react';
import { useFormSubmissions } from '@/lib/cms/hooks';
import { Inbox, X, ExternalLink } from 'lucide-react';

interface SubmissionData {
  [key: string]: unknown;
}

interface FormSubmission {
  id: string;
  formId: string;
  data: SubmissionData;
  sourcePageSlug: string | null;
  sourceLocale: string | null;
  createdAt: string;
}

export default function FormSubmissionsPage() {
  const { data: groups, isLoading } = useFormSubmissions();
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] = useState<FormSubmission | null>(null);

  // Set default active tab to first form
  const activeGroup = useMemo(() => {
    if (!groups?.length) return null;
    const id = activeFormId ?? groups[0].form.id;
    return groups.find((g) => g.form.id === id) ?? groups[0];
  }, [groups, activeFormId]);

  // Derive table columns from the active form's submissions data keys
  const columns = useMemo(() => {
    if (!activeGroup?.submissions.length) return [];
    // Collect all unique keys from submission data, excluding internal fields
    const keySet = new Set<string>();
    activeGroup.submissions.forEach((sub) => {
      Object.keys(sub.data).forEach((key) => {
        if (key !== 'submittedAt') keySet.add(key);
      });
    });
    return Array.from(keySet);
  }, [activeGroup]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Submissions</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">View leads and form submissions by source</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded bg-ora-sand/60" />
          ))}
        </div>
      ) : !groups?.length ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <Inbox className="mx-auto mb-3 h-10 w-10 stroke-1 text-ora-muted" />
          <p className="text-sm text-ora-muted">No submissions yet</p>
        </div>
      ) : (
        <>
          {/* Source tabs */}
          <div className="mb-4 flex items-center gap-1 border-b border-ora-sand">
            {groups.map((group) => {
              const isActive = activeGroup?.form.id === group.form.id;
              return (
                <button
                  key={group.form.id}
                  onClick={() => setActiveFormId(group.form.id)}
                  className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-ora-charcoal'
                      : 'text-ora-charcoal-light hover:text-ora-charcoal'
                  }`}
                >
                  {group.form.name}
                  <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-ora-sand px-1.5 text-xs">
                    {group.submissions.length}
                  </span>
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-ora-charcoal" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Table */}
          {activeGroup && activeGroup.submissions.length > 0 ? (
            <div className="overflow-x-auto border border-ora-sand/60 bg-ora-white">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ora-sand bg-ora-cream-light">
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-ora-charcoal-light">
                      Date
                    </th>
                    {columns.slice(0, 5).map((col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-ora-charcoal-light"
                      >
                        {col.replace(/([A-Z])/g, ' $1').trim()}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-ora-charcoal-light">
                      Source
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ora-sand/60">
                  {activeGroup.submissions.map((sub) => (
                    <tr
                      key={sub.id}
                      onClick={() => setSelectedSubmission(sub)}
                      className="cursor-pointer transition-colors hover:bg-ora-cream-light"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-ora-muted">
                        {new Date(sub.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      {columns.slice(0, 5).map((col) => (
                        <td key={col} className="px-4 py-3 text-sm text-ora-charcoal">
                          {formatCellValue(sub.data[col])}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        {sub.data.source ? (
                          <span className="inline-block rounded bg-ora-cream px-2 py-0.5 text-xs text-ora-charcoal-light">
                            {String(sub.data.source)}
                          </span>
                        ) : (
                          <span className="text-xs text-ora-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
              <Inbox className="mx-auto mb-3 h-10 w-10 stroke-1 text-ora-muted" />
              <p className="text-sm text-ora-muted">No submissions for this form</p>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {selectedSubmission && (
        <SubmissionDetailModal
          submission={selectedSubmission}
          formName={activeGroup?.form.name ?? ''}
          onClose={() => setSelectedSubmission(null)}
        />
      )}
    </div>
  );
}

// ── Detail Modal ─────────────────────────────────────────────────────────────

function SubmissionDetailModal({
  submission,
  formName,
  onClose,
}: {
  submission: FormSubmission;
  formName: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg border border-ora-sand bg-ora-white shadow-ora-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ora-sand px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ora-charcoal">Submission Details</h2>
            <p className="text-xs text-ora-muted">
              {formName} · {new Date(submission.createdAt).toLocaleString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-light transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          <dl className="space-y-4">
            {Object.entries(submission.data).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs font-medium uppercase tracking-wide text-ora-charcoal-light">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </dt>
                <dd className="mt-0.5 text-sm text-ora-charcoal">
                  {formatDetailValue(key, value)}
                </dd>
              </div>
            ))}
          </dl>

          {/* Meta info */}
          <div className="mt-6 border-t border-ora-sand pt-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-ora-charcoal-light">ID</span>
                <p className="mt-0.5 font-mono text-ora-charcoal">{submission.id.slice(0, 8)}…</p>
              </div>
              {submission.sourceLocale && (
                <div>
                  <span className="text-ora-charcoal-light">Locale</span>
                  <p className="mt-0.5 text-ora-charcoal">{submission.sourceLocale.toUpperCase()}</p>
                </div>
              )}
              {submission.sourcePageSlug && (
                <div>
                  <span className="text-ora-charcoal-light">Source Page</span>
                  <p className="mt-0.5 text-ora-charcoal">{submission.sourcePageSlug}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-ora-sand px-6 py-3">
          <button
            onClick={onClose}
            className="w-full rounded bg-ora-charcoal px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ora-charcoal/90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const str = String(value);
  return str.length > 30 ? str.slice(0, 30) + '…' : str;
}

function formatDetailValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
