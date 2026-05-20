'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import '@puckeditor/core/dist/index.css';
import type { Data } from '@puckeditor/core';
import { pageBuilderConfig } from '@/lib/page-builder/config';
import { migratePageData } from '@/lib/page-builder/migrate-data';
import type { PageData, ComponentInstance } from '@/lib/page-builder/types';
import { apiFetch } from '@/lib/cms/hooks/api';
import { useContentApprovalStatus, useFeatureFlag } from '@/lib/cms/hooks';
import { BuilderShell } from '@/lib/page-builder/builder-shell';

/**
 * Strip components whose `type` is no longer registered (legacy ORA blocks,
 * removed Tpl* placeholders, etc.) so the canvas never renders
 * "No configuration for X" placeholders.
 */
function sanitizePageData(data: PageData): { data: PageData; removed: string[] } {
  const known = new Set(Object.keys(pageBuilderConfig.components ?? {}));
  const removed: string[] = [];

  const filterItems = (items: ComponentInstance[]) =>
    items.filter((item) => {
      if (known.has(item.type)) return true;
      removed.push(item.type);
      return false;
    });

  const cleanContent = filterItems(data.content ?? []);
  const cleanZones: Record<string, ComponentInstance[]> = {};
  if (data.zones) {
    const liveIds = new Set<string>();
    const collect = (items: ComponentInstance[]) => {
      for (const i of items) if (i.props?.id) liveIds.add(i.props.id);
    };
    collect(cleanContent);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [zoneKey, items] of Object.entries(data.zones)) {
        const [ownerId] = zoneKey.split(':');
        if (!liveIds.has(ownerId)) continue;
        if (cleanZones[zoneKey]) continue;
        const filtered = filterItems(items);
        cleanZones[zoneKey] = filtered;
        const before = liveIds.size;
        collect(filtered);
        if (liveIds.size !== before) changed = true;
      }
    }
  }

  return { data: { ...data, content: cleanContent, zones: cleanZones }, removed };
}

// Auto-save was removed: saving is handled by BuilderShell.

export default function PageEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [page, setPage] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pending draft state
  const [pendingDraftData, setPendingDraftData] = useState<PageData | null>(null);
  const [loadingPendingDraft, setLoadingPendingDraft] = useState(false);
  const [hasPendingDraft, setHasPendingDraft] = useState(false);

  // Approval status — used to show re-edit warning
  const { data: approvalStatus } = useContentApprovalStatus('pages', id);
  const hasPendingApproval = approvalStatus?.request?.status === 'pending';
  const brandedBuilder = useFeatureFlag('branded_builder');

  // One-time warning when the dead-letter flag is set to false
  useEffect(() => {
    if (!brandedBuilder) {
      console.warn("branded_builder flag ignored; legacy PageEditor has been removed");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load page data from CMS API, then check for pending draft
  useEffect(() => {
    let cancelled = false;

    async function loadPageAndDraft() {
      try {
        const res = await apiFetch<{ data: Record<string, unknown> }>(`/api/pages/${id}`);
        if (cancelled) return;
        setPage(res.data);

        // Check if page has a pending draft
        const pageHasPendingDraft = !!(res.data as { hasPendingDraft?: boolean }).hasPendingDraft;
        setHasPendingDraft(pageHasPendingDraft);

        if (pageHasPendingDraft) {
          setLoadingPendingDraft(true);
          try {
            const draftRes = await apiFetch<{ data: PageData }>(`/api/pages/${id}/pending-draft`);
            if (cancelled) return;
            setPendingDraftData(draftRes.data);
          } catch {
            // If pending draft fetch fails, fall back to page data
            if (!cancelled) {
              setPendingDraftData(null);
              setHasPendingDraft(false);
            }
          } finally {
            if (!cancelled) setLoadingPendingDraft(false);
          }
        }
      } catch {
        if (!cancelled) setError('Failed to load page');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPageAndDraft();
    return () => { cancelled = true; };
  }, [id]);

  // Memoize so transient parent re-renders don't hand Puck a fresh `data`
  // reference and cause it to re-mount mid-edit.
  // Use pending draft data if available, otherwise fall back to page data.
  const { data: pageData, removed: removedTypes } = useMemo(() => {
    const raw = pendingDraftData
      ?? (page?.data as PageData)
      ?? { root: { props: {} }, content: [] };
    const sanitized = sanitizePageData(raw);
    return {
      data: migratePageData(sanitized.data as unknown as Data) as unknown as PageData,
      removed: sanitized.removed,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pendingDraftData]);

  if (loading || loadingPendingDraft) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-ora-muted">Loading editor…</p>
      </div>
    );
  }

  if (error && !page) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-ora-error">{error}</p>
        <button
          onClick={() => router.push('/ora-panel/pages')}
          className="h-10 bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
        >
          Back to Pages
        </button>
      </div>
    );
  }

  return (
    <div className="-m-8" style={{ height: '100vh', width: 'calc(100% + 4rem)' }}>
      <BuilderShell
          config={pageBuilderConfig as never}
          document={{
            id,
            title: (page?.title as string) ?? 'Untitled',
            slug: (page?.slug as string) ?? '',
            mode: 'page',
            status:
              ((page?.status as string) === 'published'
                ? 'published'
                : 'draft') as 'draft' | 'published',
            createdAt: (page?.createdAt as string) ?? new Date().toISOString(),
            updatedAt: (page?.updatedAt as string) ?? new Date().toISOString(),
            publishedAt: (page?.publishedAt as string | undefined) ?? undefined,
            pageData: pageData as unknown as Data,
          }}
          onSave={async (record) => {
            try {
              await apiFetch(`/api/pages/${id}`, {
                method: 'PUT',
                body: { data: record.pageData, title: record.title },
              });
              return { ok: true };
            } catch (e) {
              return {
                ok: false,
                error: e instanceof Error ? e.message : 'Save failed',
              };
            }
          }}
          onPublish={async (record) => {
            try {
              await apiFetch(`/api/pages/${id}`, {
                method: 'PUT',
                body: { data: record.pageData, title: record.title },
              });
              await apiFetch(`/api/pages/${id}/publish`, {
                method: 'POST',
                body: {},
              });
              return { ok: true };
            } catch (err) {
              const e = err as { data?: { approvalRequestId?: string }; error?: string };
              if (e?.data?.approvalRequestId) {
                // Save+gate succeeded; treat approval-pending as ok.
                return { ok: true };
              }
              return { ok: false, error: e?.error ?? 'Publish failed' };
            }
          }}
        />
    </div>
  );
}
