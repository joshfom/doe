'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';

export default function TenantsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['ai-tenants', page, search],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search) params.set('search', search);
      return fetch(`/api/ai/tenants?${params}`).then((r) => r.json());
    },
  });

  const tenants = data?.tenants ?? data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20) || 1;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">AI Tenants</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Manage tenant records for AI identification</p>
        </div>
        <Link
          href="/ora-panel/ai/tenants/new"
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
        >
          <Plus className="h-4 w-4 stroke-1" />
          Add Tenant
        </Link>
      </div>

      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-1 text-ora-muted" />
          <input
            type="text"
            placeholder="Search by name, email, or phone…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="h-10 w-full border border-ora-stone bg-ora-white pl-10 pr-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse bg-ora-sand/60" />)}
        </div>
      ) : tenants.length === 0 ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <Users className="mx-auto h-10 w-10 stroke-1 text-ora-muted" />
          <p className="mt-2 text-sm text-ora-muted">No tenants found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tenants.map((tenant: any) => (
            <Link
              key={tenant.id}
              href={`/ora-panel/ai/tenants/${tenant.id}`}
              className="flex items-center gap-4 border border-ora-sand/60 bg-ora-white p-4 hover:bg-ora-cream-light transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ora-charcoal">
                    {tenant.firstName} {tenant.lastName}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ora-muted">
                  {tenant.email || '—'} · {tenant.phone || '—'}
                  {tenant.unitNumber && ` · Unit ${tenant.unitNumber}`}
                </p>
              </div>
              <div className="shrink-0 text-right space-y-1">
                {tenant.leaseStartDate && tenant.leaseEndDate && (
                  <p className="text-xs text-ora-charcoal-light">
                    {new Date(tenant.leaseStartDate).toLocaleDateString()} — {new Date(tenant.leaseEndDate).toLocaleDateString()}
                  </p>
                )}
                {tenant.rentAmount && (
                  <p className="text-xs text-ora-muted">AED {Number(tenant.rentAmount).toLocaleString()}</p>
                )}
                <p className="text-xs text-ora-muted">
                  {tenant.createdAt ? new Date(tenant.createdAt).toLocaleDateString() : '—'}
                </p>
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
