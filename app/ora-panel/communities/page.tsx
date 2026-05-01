'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Archive, Pencil } from 'lucide-react';
import {
  useCommunities,
  useArchiveCommunity,
} from '@/lib/cms/hooks/use-communities';

export default function CommunitiesListPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: communities, isLoading } = useCommunities({ includeArchived });
  const archive = useArchiveCommunity();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Communities</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Master-planned communities. Projects belong to a community.
          </p>
        </div>
        <Link
          href="/ora-panel/communities/new"
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
        >
          <Plus className="h-4 w-4 stroke-1" />
          New Community
        </Link>
      </div>

      <label className="mb-4 inline-flex items-center gap-2 text-sm text-ora-charcoal">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        Show archived
      </label>

      {isLoading ? (
        <div className="h-32 animate-pulse bg-ora-sand/40" />
      ) : !communities || communities.length === 0 ? (
        <div className="border border-ora-sand bg-ora-white p-12 text-center text-sm text-ora-muted">
          No communities yet.
        </div>
      ) : (
        <div className="border border-ora-sand bg-ora-white">
          <table className="w-full text-sm">
            <thead className="bg-ora-cream text-left text-xs uppercase tracking-wide text-ora-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {communities.map((c) => (
                <tr key={c.id} className="border-t border-ora-sand/60">
                  <td className="px-4 py-3 text-ora-charcoal">
                    <div className="font-medium">{c.nameEn}</div>
                    {c.nameAr && (
                      <div className="text-xs text-ora-muted" dir="rtl">{c.nameAr}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ora-charcoal-light">{c.slug}</td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 text-xs border border-ora-sand bg-ora-cream">
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/ora-panel/communities/${c.id}`}
                        className="inline-flex h-8 items-center gap-1 border border-ora-sand bg-ora-white px-3 text-xs text-ora-charcoal hover:bg-ora-cream"
                      >
                        <Pencil className="h-3 w-3 stroke-1" /> Edit
                      </Link>
                      <Link
                        href={`/ora-panel/projects?communityId=${c.id}`}
                        className="inline-flex h-8 items-center gap-1 border border-ora-sand bg-ora-white px-3 text-xs text-ora-charcoal hover:bg-ora-cream"
                      >
                        Projects
                      </Link>
                      {c.status !== 'archived' && (
                        <button
                          type="button"
                          onClick={() => setConfirmId(c.id)}
                          className="inline-flex h-8 items-center gap-1 border border-ora-sand bg-ora-white px-3 text-xs text-ora-error hover:bg-ora-cream"
                        >
                          <Archive className="h-3 w-3 stroke-1" /> Archive
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-ora-white border border-ora-sand p-6 max-w-sm w-full">
            <h2 className="text-lg font-semibold text-ora-charcoal">Archive community?</h2>
            <p className="mt-2 text-sm text-ora-charcoal-light">
              Archived communities are hidden by default. Their projects remain linked.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="h-9 border border-ora-sand bg-ora-white px-4 text-sm"
                onClick={() => setConfirmId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-9 bg-ora-charcoal px-4 text-sm text-ora-white disabled:opacity-50"
                disabled={archive.isPending}
                onClick={async () => {
                  await archive.mutateAsync(confirmId);
                  setConfirmId(null);
                }}
              >
                {archive.isPending ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
