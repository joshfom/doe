'use client';

import { useState } from 'react';
import { useAuditLog } from '@/lib/cms/hooks';
import { Shield } from 'lucide-react';

const ENTITY_TYPES = ['', 'page', 'media', 'form', 'settings'] as const;
const ACTION_TYPES = ['', 'create', 'update', 'delete', 'publish', 'unpublish', 'rollback'] as const;

export default function AuditLogPage() {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');

  const filters = {
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
  };

  const { data: entries, isLoading } = useAuditLog(
    Object.keys(filters).length > 0 ? filters : undefined
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Audit Log</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Track all changes across the CMS</p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All entities</option>
          {ENTITY_TYPES.filter(Boolean).map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All actions</option>
          {ACTION_TYPES.filter(Boolean).map((a) => (
            <option key={a} value={a}>
              {a.charAt(0).toUpperCase() + a.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Entries */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded bg-ora-sand/60" />
          ))}
        </div>
      ) : !entries?.length ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <Shield className="mx-auto mb-3 h-10 w-10 stroke-1 text-ora-muted" />
          <p className="text-sm text-ora-muted">No audit entries found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-4 border border-ora-sand/60 bg-ora-white p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`inline-block rounded-full px-3 py-0.5 text-xs font-medium ${actionBadge(entry.action)}`}>
                    {entry.action}
                  </span>
                  <span className="inline-block rounded-full bg-ora-sand px-3 py-0.5 text-xs text-ora-charcoal-light">
                    {entry.entityType}
                  </span>
                </div>
                <p className="mt-1 text-sm text-ora-charcoal">{entry.summary}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-ora-muted">
                  {new Date(entry.createdAt).toLocaleString()}
                </p>
                <p className="text-xs text-ora-muted">User: {entry.userId.slice(0, 8)}…</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function actionBadge(action: string): string {
  switch (action) {
    case 'create':
      return 'bg-ora-success/10 text-ora-success';
    case 'update':
      return 'bg-ora-info/10 text-ora-info';
    case 'delete':
      return 'bg-ora-error/10 text-ora-error';
    case 'publish':
      return 'bg-ora-gold/10 text-ora-gold-dark';
    case 'unpublish':
      return 'bg-ora-warning/10 text-ora-warning';
    case 'rollback':
      return 'bg-ora-warning/10 text-ora-warning';
    default:
      return 'bg-ora-sand text-ora-charcoal-light';
  }
}
