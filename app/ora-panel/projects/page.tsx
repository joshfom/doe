'use client';

import { useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Plus, Pencil, Archive, ExternalLink } from 'lucide-react';
import {
  useProjects,
  useArchiveProject,
} from '@/lib/cms/hooks/use-communities';
import { useCommunities } from '@/lib/cms/hooks/use-communities';
import { useSiteSettings } from '@/lib/cms/hooks';

function ProjectsContent() {
  const sp = useSearchParams();
  const initialCommunityId = sp.get('communityId') ?? '';
  const [communityId, setCommunityId] = useState(initialCommunityId);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data: communities } = useCommunities();
  const { data: projects, isLoading } = useProjects({
    communityId: communityId || undefined,
    includeArchived,
  });
  const archive = useArchiveProject();
  const { data: settingsEntries } = useSiteSettings();
  const { enPrefix, arPrefix } = useMemo(() => {
    const map: Record<string, string> = {};
    for (const e of settingsEntries ?? []) map[e.key] = e.value;
    return {
      enPrefix: (map.project_slug_prefix || 'projects').trim(),
      arPrefix: (
        map.project_slug_prefix_ar ||
        map.project_slug_prefix ||
        'projects'
      ).trim(),
    };
  }, [settingsEntries]);

  const communityName = useMemo(() => {
    if (!communityId || !communities) return null;
    return communities.find((c) => c.id === communityId)?.nameEn ?? null;
  }, [communityId, communities]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Projects</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Developments inside a community. Each project has its own brochure, floorplans and amenities.
          </p>
        </div>
        <Link
          href={`/ora-panel/projects/new${communityId ? `?communityId=${communityId}` : ''}`}
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
        >
          <Plus className="h-4 w-4 stroke-1" />
          New Project
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <label className="text-xs uppercase tracking-wide text-ora-muted">Community</label>
        <select
          value={communityId}
          onChange={(e) => setCommunityId(e.target.value)}
          className="h-9 border border-ora-sand bg-ora-white px-3 text-sm"
        >
          <option value="">All communities</option>
          {communities?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameEn}
            </option>
          ))}
        </select>

        <label className="ml-4 inline-flex items-center gap-2 text-sm text-ora-charcoal">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>

        {communityName && (
          <span className="ml-auto text-xs text-ora-muted">
            Filtered by: <strong>{communityName}</strong>
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="h-32 animate-pulse bg-ora-sand/40" />
      ) : !projects || projects.length === 0 ? (
        <div className="border border-ora-sand bg-ora-white p-12 text-center text-sm text-ora-muted">
          No projects yet.
        </div>
      ) : (
        <div className="border border-ora-sand bg-ora-white">
          <table className="w-full text-sm">
            <thead className="bg-ora-cream text-left text-xs uppercase tracking-wide text-ora-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Handover</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-t border-ora-sand/60">
                  <td className="px-4 py-3 text-ora-charcoal">
                    <div className="font-medium">{p.nameEn}</div>
                  </td>
                  <td className="px-4 py-3 text-ora-charcoal-light">
                    <div className="flex items-center gap-2">
                      <span>{p.slug}</span>
                      {p.status !== 'archived' && (
                        <>
                          <a
                            href={`/${enPrefix}/${p.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`View live EN: /${enPrefix}/${p.slug}`}
                            className="inline-flex items-center gap-1 border border-ora-sand bg-ora-cream px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ora-muted hover:border-ora-gold hover:text-ora-gold"
                          >
                            EN
                            <ExternalLink className="h-3 w-3 stroke-1" />
                          </a>
                          <a
                            href={`/ar/${arPrefix}/${p.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`View live AR: /ar/${arPrefix}/${p.slug}`}
                            className="inline-flex items-center gap-1 border border-ora-sand bg-ora-cream px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ora-muted hover:border-ora-gold hover:text-ora-gold"
                          >
                            AR
                            <ExternalLink className="h-3 w-3 stroke-1" />
                          </a>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-block px-2 py-0.5 text-xs border border-ora-sand bg-ora-cream">
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ora-charcoal-light">
                    {p.expectedHandoverDate ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/ora-panel/projects/${p.id}`}
                        className="inline-flex h-8 items-center gap-1 border border-ora-sand bg-ora-white px-3 text-xs text-ora-charcoal hover:bg-ora-cream"
                      >
                        <Pencil className="h-3 w-3 stroke-1" /> Edit
                      </Link>
                      {p.status !== 'archived' && (
                        <button
                          type="button"
                          onClick={() => setConfirmId(p.id)}
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
            <h2 className="text-lg font-semibold text-ora-charcoal">Archive project?</h2>
            <p className="mt-2 text-sm text-ora-charcoal-light">
              The project will be hidden from public listings but its data is preserved.
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

export default function ProjectsListPage() {
  return (
    <Suspense fallback={<div className="h-32 animate-pulse bg-ora-sand/40" />}>
      <ProjectsContent />
    </Suspense>
  );
}
