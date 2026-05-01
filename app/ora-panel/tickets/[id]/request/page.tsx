'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  useTicket,
  useUpdateTicketRequest,
  useCommunities,
  useProjects,
} from '@/lib/cms/hooks';
import { RequestDataForm } from './request-forms';

const REQUEST_TYPES = [
  { value: 'general_inquiry', label: 'General inquiry' },
  { value: 'noc', label: 'NOC' },
  { value: 'move_in', label: 'Move-in' },
  { value: 'move_out', label: 'Move-out' },
  { value: 'gate_pass', label: 'Gate pass' },
  { value: 'technician_visit', label: 'Technician visit' },
  { value: 'construction_material_delivery', label: 'Construction material delivery' },
  { value: 'vendor_access', label: 'Vendor access' },
  { value: 'maintenance_request', label: 'Maintenance request' },
] as const;

const REQUEST_HINTS: Record<string, string> = {
  noc: 'Required: nocType, workDescription, plannedStartDate, plannedEndDate',
  move_in: 'Required: moveDate; optional: moverCompany, truckPlates, crewSize',
  move_out: 'Required: moveDate; optional: moverCompany, truckPlates, crewSize',
  gate_pass: 'Required: passType, visitor.name, purpose, validFrom, validUntil',
  technician_visit: 'Required: discipline, issueSummary',
  construction_material_delivery: 'Required: vendor.name, materials[], deliveryDate',
  vendor_access: 'Required: vendor.name, purpose, accessFrom, accessUntil',
  maintenance_request: 'Required: area, severity, description',
  general_inquiry: 'No structured data required',
};

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // YYYY-MM-DDTHH:mm
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EditTicketRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: detail, isLoading } = useTicket(id);
  const ticket = detail?.ticket;
  const update = useUpdateTicketRequest(id);

  const [requestType, setRequestType] = useState('general_inquiry');
  const [communityId, setCommunityId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [scheduledStart, setScheduledStart] = useState('');
  const [scheduledEnd, setScheduledEnd] = useState('');
  const [requestData, setRequestData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const { data: communities } = useCommunities();
  const { data: projects } = useProjects(
    communityId ? { communityId } : undefined
  );

  useEffect(() => {
    if (!ticket) return;
    setRequestType(ticket.requestType);
    setCommunityId(ticket.communityId ?? '');
    setProjectId(ticket.projectId ?? '');
    setUnitNumber(ticket.unitNumber ?? '');
    setScheduledStart(toDatetimeLocal(ticket.scheduledStart));
    setScheduledEnd(toDatetimeLocal(ticket.scheduledEnd));
    setRequestData(
      ticket.requestData && typeof ticket.requestData === 'object'
        ? (ticket.requestData as Record<string, unknown>)
        : {}
    );
  }, [ticket]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaved(false);

    // For typed requests, send the structured object even when empty so
    // server-side validation runs. General inquiry sends `null` when empty.
    const hasData = Object.keys(requestData).length > 0;
    const payload =
      requestType === 'general_inquiry'
        ? hasData
          ? requestData
          : null
        : requestData;

    try {
      await update.mutateAsync({
        requestType,
        communityId: communityId || null,
        projectId: projectId || null,
        unitNumber: unitNumber.trim() || null,
        scheduledStart: scheduledStart ? new Date(scheduledStart).toISOString() : null,
        scheduledEnd: scheduledEnd ? new Date(scheduledEnd).toISOString() : null,
        requestData: payload,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      const e = err as {
        error?: string;
        message?: string;
        details?: Record<string, string>;
      };
      setError(e.error ?? e.message ?? 'Failed to update');
      if (e.details) setFieldErrors(e.details);
    }
  }

  if (isLoading) return <div className="h-32 animate-pulse bg-ora-sand/40" />;
  if (!ticket) return <div className="text-sm text-ora-error">Ticket not found.</div>;

  return (
    <div className="max-w-3xl">
      <Link
        href={`/ora-panel/tickets/${id}`}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ora-charcoal-light hover:text-ora-charcoal"
      >
        <ArrowLeft className="h-3 w-3 stroke-1" /> Back to ticket
      </Link>
      <h1 className="mb-2 text-2xl font-semibold text-ora-charcoal">Edit request</h1>
      <p className="mb-6 text-sm text-ora-muted">
        Ticket {ticket.ticketNumber} · {ticket.subject}
      </p>

      <form onSubmit={onSubmit} className="space-y-6">
        {error && (
          <div className="border border-ora-error/40 bg-ora-error/10 p-3 text-sm text-ora-error">
            {error}
          </div>
        )}
        {saved && (
          <div className="border border-ora-success/40 bg-ora-success/10 p-3 text-sm text-ora-success">
            Changes saved.
          </div>
        )}

        <section className="border border-ora-sand bg-ora-white p-6 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ora-muted">
              Request type
            </label>
            <select
              value={requestType}
              onChange={(e) => setRequestType(e.target.value)}
              className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
            >
              {REQUEST_TYPES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ora-muted">{REQUEST_HINTS[requestType]}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ora-muted">
                Community
              </label>
              <select
                value={communityId}
                onChange={(e) => {
                  setCommunityId(e.target.value);
                  setProjectId('');
                }}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              >
                <option value="">— None —</option>
                {communities?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ora-muted">
                Project
              </label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={!communityId}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm disabled:opacity-50"
              >
                <option value="">— None —</option>
                {projects?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameEn}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ora-muted">
              Unit number
            </label>
            <input
              value={unitNumber}
              onChange={(e) => setUnitNumber(e.target.value)}
              placeholder="e.g. A-1204"
              className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ora-muted">
                Scheduled start
              </label>
              <input
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ora-muted">
                Scheduled end
              </label>
              <input
                type="datetime-local"
                value={scheduledEnd}
                onChange={(e) => setScheduledEnd(e.target.value)}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              />
            </div>
          </div>
        </section>

        <section className="border border-ora-sand bg-ora-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ora-charcoal">
              Structured request data
            </h2>
            <span className="text-[10px] uppercase tracking-wide text-ora-muted">
              {REQUEST_HINTS[requestType]}
            </span>
          </div>
          <RequestDataForm
            requestType={requestType}
            value={requestData}
            onChange={setRequestData}
            fieldErrors={fieldErrors}
          />
          {Object.keys(fieldErrors).length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-ora-error">
                {Object.keys(fieldErrors).length} validation error
                {Object.keys(fieldErrors).length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 list-inside list-disc text-xs text-ora-error">
                {Object.entries(fieldErrors).map(([k, v]) => (
                  <li key={k}>
                    <span className="font-mono">{k}</span>: {v}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <div className="flex justify-end gap-2">
          <button
            type="submit"
            disabled={update.isPending}
            className="inline-flex h-10 items-center bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite disabled:opacity-50"
          >
            {update.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
