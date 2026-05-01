'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ChevronRight, Save } from 'lucide-react';

const UNIT_TYPES = ['apartment', 'villa', 'townhouse', 'office'] as const;
const UNIT_STATUSES = ['available', 'sold', 'reserved', 'rented', 'under_construction'] as const;

export default function NewUnitPage() {
  const router = useRouter();
  const [projectName, setProjectName] = useState('');
  const [unitNumber, setUnitNumber] = useState('');
  const [unitType, setUnitType] = useState<string>('apartment');
  const [floorNumber, setFloorNumber] = useState('');
  const [areaSqm, setAreaSqm] = useState('');
  const [status, setStatus] = useState<string>('available');
  const [constructionProgress, setConstructionProgress] = useState('');
  const [estimatedHandoverDate, setEstimatedHandoverDate] = useState('');
  const [clientId, setClientId] = useState('');
  const [tenantId, setTenantId] = useState('');

  const { data: clientsData } = useQuery({
    queryKey: ['ai-clients-dropdown'],
    queryFn: () => fetch('/api/ai/clients?limit=200').then((r) => r.json()),
  });
  const clients = clientsData?.clients ?? clientsData?.data ?? [];

  const { data: tenantsData } = useQuery({
    queryKey: ['ai-tenants-dropdown'],
    queryFn: () => fetch('/api/ai/tenants?limit=200').then((r) => r.json()),
  });
  const tenants = tenantsData?.tenants ?? tenantsData?.data ?? [];

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch('/api/ai/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: () => router.push('/ora-panel/ai/units'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim() || !unitNumber.trim()) return;
    create.mutate({
      projectName: projectName.trim(), unitNumber: unitNumber.trim(), unitType, status,
      floorNumber: floorNumber ? Number(floorNumber) : undefined,
      areaSqm: areaSqm ? Number(areaSqm) : undefined,
      constructionProgress: constructionProgress ? Number(constructionProgress) : undefined,
      estimatedHandoverDate: estimatedHandoverDate || undefined,
      clientId: clientId || undefined, tenantId: tenantId || undefined,
    });
  };

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/ai/units" className="hover:text-ora-charcoal transition-colors">AI Units</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">New Unit</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">New Unit</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Add a new unit record</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Project Name</label>
              <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} required className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Unit Number</label>
              <input type="text" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} required className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Unit Type</label>
              <select value={unitType} onChange={(e) => setUnitType(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                {UNIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Floor Number</label>
              <input type="number" value={floorNumber} onChange={(e) => setFloorNumber(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Area (sqm)</label>
              <input type="number" value={areaSqm} onChange={(e) => setAreaSqm(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                {UNIT_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Construction Progress (%)</label>
              <input type="number" min="0" max="100" value={constructionProgress} onChange={(e) => setConstructionProgress(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Estimated Handover Date</label>
            <input type="date" value={estimatedHandoverDate} onChange={(e) => setEstimatedHandoverDate(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Client</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                <option value="">None</option>
                {clients.map((c: any) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Tenant</label>
              <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                <option value="">None</option>
                {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {create.isError && <p className="text-sm text-ora-error">Failed to create unit.</p>}
          <button type="submit" disabled={create.isPending || !projectName.trim() || !unitNumber.trim()} className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50">
            <Save className="h-3.5 w-3.5 stroke-1" /> {create.isPending ? 'Creating…' : 'Create Unit'}
          </button>
        </div>
      </form>
    </div>
  );
}
