'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface CalendarEvent {
  id: string;
  type: 'appointment' | 'ticket';
  title: string;
  start: string; // ISO
  end: string | null;
  status: string;
  category: string | null;
  refUrl: string;
  contactName: string | null;
  contactEmail: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfNextMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
function startOfGrid(d: Date) {
  // First Monday on or before the 1st of the month.
  const first = startOfMonth(d);
  const day = first.getDay(); // 0 = Sun
  const offset = day === 0 ? 6 : day - 1;
  const grid = new Date(first);
  grid.setDate(first.getDate() - offset);
  return grid;
}
function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function fmtMonth(d: Date) {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Color per event category (ticket request type or appointment type).
function eventColor(evt: CalendarEvent): string {
  if (evt.type === 'appointment') {
    return 'bg-ora-info/15 text-ora-info border-l-2 border-ora-info';
  }
  // ticket — color by request type
  switch (evt.category) {
    case 'maintenance_request':
    case 'technician_visit':
      return 'bg-ora-success/15 text-ora-success border-l-2 border-ora-success';
    case 'move_in':
    case 'move_out':
    case 'gate_pass':
    case 'vendor_access':
    case 'construction_material_delivery':
    case 'noc':
      return 'bg-ora-warning/15 text-ora-warning border-l-2 border-ora-warning';
    default:
      return 'bg-ora-sand text-ora-charcoal border-l-2 border-ora-charcoal-light';
  }
}

const STATUS_FADE: Record<string, string> = {
  resolved: 'opacity-60',
  closed: 'opacity-50',
  cancelled: 'opacity-50',
  completed: 'opacity-60',
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const from = useMemo(() => startOfGrid(cursor), [cursor]);
  const to = useMemo(() => {
    const d = new Date(from);
    d.setDate(d.getDate() + 42); // 6 weeks
    return d;
  }, [from]);

  const { data, isLoading } = useQuery({
    queryKey: ['calendar-events', from.toISOString(), to.toISOString()],
    queryFn: () => {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
      });
      return fetch(`/api/calendar/events?${params}`).then((r) => r.json());
    },
  });

  const events: CalendarEvent[] = data?.data ?? [];

  // Group events by YYYY-MM-DD
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const evt of events) {
      const d = new Date(evt.start);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const arr = map.get(key) ?? [];
      arr.push(evt);
      map.set(key, arr);
    }
    return map;
  }, [events]);

  // Build 6×7 grid of days
  const days = useMemo(() => {
    const arr: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [from]);

  const today = new Date();
  const monthIndex = cursor.getMonth();

  const prev = () =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const next = () => setCursor(startOfNextMonth(cursor));
  const goToday = () => setCursor(startOfMonth(new Date()));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-ora-charcoal">
            <CalendarDays className="h-6 w-6" /> Calendar
          </h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Unified view of AI appointments and scheduled tickets (permits, technician visits, vendor access, deliveries).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={prev}
            className="rounded-md border border-ora-sand p-2 hover:bg-ora-sand"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goToday}
            className="rounded-md border border-ora-sand px-3 py-1.5 text-sm hover:bg-ora-sand"
          >
            Today
          </button>
          <button
            onClick={next}
            className="rounded-md border border-ora-sand p-2 hover:bg-ora-sand"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-3 min-w-40 text-right text-lg font-medium text-ora-charcoal">
            {fmtMonth(cursor)}
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs text-ora-charcoal-light">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-ora-info/40" /> AI Appointment
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-ora-warning/40" /> Permit / Access
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-ora-success/40" /> Maintenance / Technician
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-ora-sand" /> Other ticket
        </span>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-ora-sand bg-ora-sand">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <div
            key={d}
            className="bg-white px-2 py-2 text-xs font-medium uppercase tracking-wide text-ora-charcoal-light"
          >
            {d}
          </div>
        ))}

        {days.map((day) => {
          const inMonth = day.getMonth() === monthIndex;
          const isToday = isSameDay(day, today);
          const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
          const dayEvents = eventsByDay.get(key) ?? [];

          return (
            <div
              key={key}
              className={`min-h-28 bg-white p-2 ${inMonth ? '' : 'bg-ora-sand/30'}`}
            >
              <div
                className={`mb-1 flex items-center justify-between text-xs ${
                  inMonth ? 'text-ora-charcoal' : 'text-ora-charcoal-light/60'
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${
                    isToday
                      ? 'bg-ora-charcoal text-white font-medium'
                      : ''
                  }`}
                >
                  {day.getDate()}
                </span>
                {dayEvents.length > 0 && (
                  <span className="text-[10px] text-ora-charcoal-light">
                    {dayEvents.length}
                  </span>
                )}
              </div>

              <div className="space-y-1">
                {dayEvents.slice(0, 3).map((evt) => (
                  <Link
                    key={evt.id}
                    href={evt.refUrl}
                    className={`block truncate rounded px-1.5 py-0.5 text-[11px] ${eventColor(evt)} ${STATUS_FADE[evt.status] ?? ''} hover:brightness-95`}
                    title={`${fmtTime(evt.start)} — ${evt.title} (${evt.status})`}
                  >
                    <span className="font-medium">{fmtTime(evt.start)}</span>{' '}
                    <span className="truncate">{evt.title}</span>
                  </Link>
                ))}
                {dayEvents.length > 3 && (
                  <span className="block text-[10px] text-ora-charcoal-light">
                    +{dayEvents.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isLoading && (
        <p className="mt-3 text-sm text-ora-charcoal-light">Loading events…</p>
      )}
      {!isLoading && events.length === 0 && (
        <p className="mt-3 text-sm text-ora-charcoal-light">
          No events scheduled in this month.
        </p>
      )}
    </div>
  );
}
