'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Save, Trash2 } from 'lucide-react';
import { DetailPageSkeleton } from '@/components/ui/panel-skeletons';

const UNIT_TYPES = ['apartment', 'villa', 'townhouse', 'office'] as const;
const UNIT_STATUSES = ['available', 'sold', 'reserved', 'rented', 'under_construction'] as const;

export default function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: unit, isLoading } = useQuery({
    queryKey: ['ai-unit', id],
    queryFn: () => fetch(`/api/ai/units/${id}`).then((r) => r.json()),
  });

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
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!unit) return;
    const u = unit.unit ?? unit;
    setProjectName(u.projectName ?? '');
    setUnitNumber(u.unitNumber ?? '');
    setUnitType(u.unitType ?? 'apartment');
    setFloorNumber(u.floorNumber != null ? String(u.floorNumber) : '');
    setAreaSqm(u.areaSqm != null ? String(u.areaSqm) : '');
    setStatus(u.status ?? 'available');
    setConstructionProgress(u.constructionProgress != null ? String(u.constructionProgress) : '');
    setEstimatedHandoverDate(u.estimatedHandoverDate ? u.estimatedHandoverDate.slice(0, 10) : '');
    setClientId(u.clientId ?? '');
    setTenantId(u.tenantId ?? '');
  }, [unit]);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch(`/api/ai/units/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-unit', id] });
      queryClient.invalidateQueries({ queryKey: ['ai-units'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const remove = useMutation({
    mutationFn: () => fetch(`/api/ai/units/${id}`, { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: () => router.push('/ora-panel/ai/units'),
  });

  const handleSave = () => {
    if (!projectName.trim() || !unitNumber.trim()) return;
    update.mutate({
      projectName: projectName.trim(), unitNumber: unitNumber.trim(), unitType, status,
      floorNumber: floorNumber ? Number(floorNumber) : undefined,
      areaSqm: areaSqm ? Number(areaSqm) : undefined,
      constructionProgress: constructionProgress ? Number(constructionProgress) : undefined,
      estimatedHandoverDate: estimatedHandoverDate || undefined,
      clientId: clientId || null, tenantId: tenantId || null,
    });
  };

  if (isLoading) return <DetailPageSkeleton fieldsPerSection={6} />;

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/ai/units" className="hover:text-ora-charcoal transition-colors">AI Units</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">Edit Unit</span>
      </nav>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Edit Unit</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Update unit record</p>
        </div>
        {confirmDelete ? (
          <div className="flex gap-2">
            <button onClick={() => remove.mutate()} disabled={remove.isPending} className="h-10 bg-ora-error px-6 text-sm text-ora-white hover:bg-ora-error/90 transition-colors">Confirm Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="h-10 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="inline-flex h-10 items-center gap-2 bg-ora-error/10 px-6 text-sm text-ora-error hover:bg-ora-error/20 transition-colors">
            <Trash2 className="h-4 w-4 stroke-1" /> Delete
          </button>
        )}
      </div>

      <div className="max-w-2xl space-y-6">
        <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Project Name</label>
              <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Unit Number</label>
              <input type="text" value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
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
          {saved && <span className="text-sm text-ora-success">Saved</span>}
          {update.isError && <span className="text-sm text-ora-error">Failed to save.</span>}
          <button onClick={handleSave} disabled={update.isPending || !projectName.trim() || !unitNumber.trim()} className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50">
            <Save className="h-3.5 w-3.5 stroke-1" /> {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
