'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Save, Trash2 } from 'lucide-react';
import { DetailPageSkeleton } from '@/components/ui/panel-skeletons';

export default function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['ai-tenant', id],
    queryFn: () => fetch(`/api/ai/tenants/${id}`).then((r) => r.json()),
  });

  const { data: unitsData } = useQuery({
    queryKey: ['ai-units-dropdown'],
    queryFn: () => fetch('/api/ai/units?limit=200').then((r) => r.json()),
  });
  const units = unitsData?.units ?? unitsData?.data ?? [];

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [unitId, setUnitId] = useState('');
  const [leaseStartDate, setLeaseStartDate] = useState('');
  const [leaseEndDate, setLeaseEndDate] = useState('');
  const [rentAmount, setRentAmount] = useState('');
  const [paymentFrequency, setPaymentFrequency] = useState('monthly');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!tenant) return;
    const t = tenant.tenant ?? tenant;
    setFirstName(t.firstName ?? '');
    setLastName(t.lastName ?? '');
    setEmail(t.email ?? '');
    setPhone(t.phone ?? '');
    setUnitId(t.unitId ?? '');
    setLeaseStartDate(t.leaseStartDate ? t.leaseStartDate.slice(0, 10) : '');
    setLeaseEndDate(t.leaseEndDate ? t.leaseEndDate.slice(0, 10) : '');
    setRentAmount(t.rentAmount != null ? String(t.rentAmount) : '');
    setPaymentFrequency(t.paymentFrequency ?? 'monthly');
    setNotes(t.notes ?? '');
  }, [tenant]);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch(`/api/ai/tenants/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-tenant', id] });
      queryClient.invalidateQueries({ queryKey: ['ai-tenants'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const remove = useMutation({
    mutationFn: () => fetch(`/api/ai/tenants/${id}`, { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error('Failed'); return r.json(); }),
    onSuccess: () => router.push('/ora-panel/ai/tenants'),
  });

  const handleSave = () => {
    if (!firstName.trim() || !lastName.trim()) return;
    update.mutate({
      firstName: firstName.trim(), lastName: lastName.trim(),
      email: email.trim() || undefined, phone: phone.trim() || undefined,
      unitId: unitId || undefined,
      leaseStartDate: leaseStartDate || undefined, leaseEndDate: leaseEndDate || undefined,
      rentAmount: rentAmount ? Number(rentAmount) : undefined,
      paymentFrequency, notes: notes.trim() || undefined,
    });
  };

  if (isLoading) return <DetailPageSkeleton fieldsPerSection={6} />;

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/ai/tenants" className="hover:text-ora-charcoal transition-colors">AI Tenants</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">Edit Tenant</span>
      </nav>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Edit Tenant</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Update tenant record</p>
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
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">First Name</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Last Name</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Phone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Unit</label>
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
              <option value="">Select unit…</option>
              {units.map((u: any) => (
                <option key={u.id} value={u.id}>{u.projectName} — {u.unitNumber}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Lease Start Date</label>
              <input type="date" value={leaseStartDate} onChange={(e) => setLeaseStartDate(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Lease End Date</label>
              <input type="date" value={leaseEndDate} onChange={(e) => setLeaseEndDate(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Rent Amount (AED)</label>
              <input type="number" value={rentAmount} onChange={(e) => setRentAmount(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Payment Frequency</label>
              <select value={paymentFrequency} onChange={(e) => setPaymentFrequency(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="semi_annually">Semi-Annually</option>
                <option value="annually">Annually</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-ora-success">Saved</span>}
          {update.isError && <span className="text-sm text-ora-error">Failed to save.</span>}
          <button onClick={handleSave} disabled={update.isPending || !firstName.trim() || !lastName.trim()} className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50">
            <Save className="h-3.5 w-3.5 stroke-1" /> {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
