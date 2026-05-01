'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Building2 } from 'lucide-react';

const UNIT_STATUSES = ['available', 'sold', 'reserved', 'rented', 'under_construction'] as const;
const UNIT_TYPES = ['apartment', 'villa', 'townhouse', 'office'] as const;

function statusBadge(status: string) {
  switch (status) {
    case 'available': return 'bg-ora-success/10 text-ora-success';
    case 'sold': return 'bg-ora-gold/10 text-ora-gold-dark';
    case 'reserved': return 'bg-ora-warning/10 text-ora-warning';
    case 'rented': return 'bg-ora-info/10 text-ora-info';
    case 'under_construction': return 'bg-ora-sand text-ora-charcoal-light';
    default: return 'bg-ora-sand text-ora-charcoal-light';
  }
}

export default function UnitsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [unitType, setUnitType] = useState('');
  const [projectName, setProjectName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ai-units', page, status, unitType, projectName],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (status) params.set('status', status);
      if (unitType) params.set('unitType', unitType);
      if (projectName) params.set('projectName', projectName);
      return fetch(`/api/ai/units?${params}`).then((r) => r.json());
    },
  });

  const units = data?.units ?? data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20) || 1;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">AI Units</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Manage unit records for AI queries</p>
        </div>
        <Link
          href="/ora-panel/ai/units/new"
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
        >
          <Plus className="h-4 w-4 stroke-1" />
          Add Unit
        </Link>
      </div>

      <div className="mb-4 flex gap-3">
        <input
          type="text"
          placeholder="Project name…"
          value={projectName}
          onChange={(e) => { setProjectName(e.target.value); setPage(1); }}
          className="h-10 flex-1 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        />
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All statuses</option>
          {UNIT_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select
          value={unitType}
          onChange={(e) => { setUnitType(e.target.value); setPage(1); }}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All types</option>
          {UNIT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse bg-ora-sand/60" />)}
        </div>
      ) : units.length === 0 ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <Building2 className="mx-auto h-10 w-10 stroke-1 text-ora-muted" />
          <p className="mt-2 text-sm text-ora-muted">No units found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {units.map((unit: any) => (
            <Link
              key={unit.id}
              href={`/ora-panel/ai/units/${unit.id}`}
              className="flex items-center gap-4 border border-ora-sand/60 bg-ora-white p-4 hover:bg-ora-cream-light transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ora-charcoal">
                    {unit.projectName} — {unit.unitNumber}
                  </span>
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${statusBadge(unit.status)}`}>
                    {unit.status?.replace(/_/g, ' ')}
                  </span>
                  <span className="inline-block px-2 py-0.5 text-[10px] font-medium bg-ora-sand/50 text-ora-charcoal-light capitalize">
                    {unit.unitType}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ora-muted">
                  Floor {unit.floorNumber ?? '—'} · {unit.areaSqm ?? '—'} sqm
                  {unit.constructionProgress != null && ` · ${unit.constructionProgress}% complete`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {unit.constructionProgress != null && (
                  <div className="mb-1 h-1.5 w-24 bg-ora-sand">
                    <div className="h-full bg-ora-gold" style={{ width: `${unit.constructionProgress}%` }} />
                  </div>
                )}
              </div>
            </Link>
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
