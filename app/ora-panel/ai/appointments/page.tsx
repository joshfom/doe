'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Search } from 'lucide-react';

const STATUS_OPTIONS = ['confirmed', 'cancelled', 'rescheduled', 'completed'] as const;
const TYPE_OPTIONS = ['site_visit', 'consultation', 'payment_discussion', 'maintenance_request'] as const;

function statusBadge(status: string) {
  switch (status) {
    case 'confirmed': return 'bg-ora-success/10 text-ora-success';
    case 'cancelled': return 'bg-ora-error/10 text-ora-error';
    case 'rescheduled': return 'bg-ora-warning/10 text-ora-warning';
    case 'completed': return 'bg-ora-info/10 text-ora-info';
    default: return 'bg-ora-sand text-ora-charcoal-light';
  }
}

export default function AppointmentsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [appointmentType, setAppointmentType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ai-appointments', page, status, appointmentType, dateFrom, dateTo],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status) params.set('status', status);
      if (appointmentType) params.set('type', appointmentType);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      return fetch(`/api/ai/appointments?${params}`).then((r) => r.json());
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/ai/appointments/${id}/cancel`, { method: 'PATCH' }).then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-appointments'] });
      setCancelId(null);
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: ({ id, date, time }: { id: string; date: string; time: string }) =>
      fetch(`/api/ai/appointments/${id}/reschedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledDate: date, scheduledTime: time }),
      }).then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-appointments'] });
      setRescheduleId(null);
      setNewDate('');
      setNewTime('');
    },
  });

  const appointments = data?.appointments ?? data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20) || 1;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">AI Appointments</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Manage appointments booked through AI</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select
          value={appointmentType}
          onChange={(e) => { setAppointmentType(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
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
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse bg-ora-sand/60" />)}
        </div>
      ) : appointments.length === 0 ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <CalendarDays className="mx-auto h-10 w-10 stroke-1 text-ora-muted" />
          <p className="mt-2 text-sm text-ora-muted">No appointments found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.map((apt: any) => (
            <div key={apt.id} className="border border-ora-sand/60 bg-ora-white p-4">
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ora-charcoal font-mono">{apt.referenceNumber}</span>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${statusBadge(apt.status)}`}>
                      {apt.status}
                    </span>
                    <span className="inline-block px-2 py-0.5 text-[10px] font-medium bg-ora-sand/50 text-ora-charcoal-light">
                      {apt.appointmentType?.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ora-charcoal-light">
                    {apt.contactName || '—'} · {apt.contactEmail || apt.contactPhone || '—'}
                  </p>
                  <p className="mt-0.5 text-xs text-ora-muted">
                    {apt.scheduledDate ? new Date(apt.scheduledDate).toLocaleDateString() : '—'}
                    {apt.scheduledTime && ` at ${apt.scheduledTime}`}
                  </p>
                </div>
                <div className="shrink-0 flex gap-2">
                  {apt.status === 'confirmed' && (
                    <>
                      {cancelId === apt.id ? (
                        <div className="flex gap-2">
                          <button onClick={() => cancelMutation.mutate(apt.id)} disabled={cancelMutation.isPending} className="h-9 bg-ora-error px-4 text-sm text-ora-white hover:bg-ora-error/90 transition-colors">Confirm</button>
                          <button onClick={() => setCancelId(null)} className="h-9 border border-ora-sand bg-ora-cream px-4 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">No</button>
                        </div>
                      ) : (
                        <button onClick={() => setCancelId(apt.id)} className="h-9 px-4 border border-ora-sand bg-ora-cream text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">Cancel</button>
                      )}
                      {rescheduleId === apt.id ? (
                        <div className="flex gap-2 items-center">
                          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-9 border border-ora-stone bg-ora-white px-2 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
                          <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} className="h-9 border border-ora-stone bg-ora-white px-2 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
                          <button onClick={() => rescheduleMutation.mutate({ id: apt.id, date: newDate, time: newTime })} disabled={rescheduleMutation.isPending || !newDate || !newTime} className="h-9 bg-ora-gold px-4 text-sm text-ora-white hover:bg-ora-gold-dark transition-colors disabled:opacity-50">Save</button>
                          <button onClick={() => { setRescheduleId(null); setNewDate(''); setNewTime(''); }} className="h-9 border border-ora-sand bg-ora-cream px-4 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setRescheduleId(apt.id)} className="h-9 px-4 border border-ora-sand bg-ora-cream text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">Reschedule</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="h-9 px-4 border border-ora-sand bg-ora-cream text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors disabled:opacity-50">Previous</button>
          <span className="text-sm text-ora-muted">Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="h-9 px-4 border border-ora-sand bg-ora-cream text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors disabled:opacity-50">Next</button>
        </div>
      )}
    </div>
  );
}
