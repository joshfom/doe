'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import '@puckeditor/core/dist/index.css';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';
import { pageBuilderConfig } from '@/lib/page-builder/config';
import { createOverrides } from '@/lib/page-builder/components/ui-overrides';
import { createEditorPlugins } from '@/lib/page-builder/components/plugins';
import { defaultTheme } from '@/lib/page-builder/theme';
import type { PageData, ComponentInstance } from '@/lib/page-builder/types';
import { apiFetch } from '@/lib/cms/hooks/api';

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

// Auto-save was removed: it was re-mounting Puck mid-edit and losing focus on
// inputs. Saving is now manual (Save Draft button) plus a sendBeacon flush on
// page unload as a safety net.
const SAVED_INDICATOR_DURATION = 2_000; // 2 seconds

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
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  // Ref to track the latest editor data for manual save and beforeunload
  const latestDataRef = useRef<Data | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  // Load page data from CMS API
  useEffect(() => {
    apiFetch<{ data: Record<string, unknown> }>(`/api/pages/${id}`)
      .then((res) => {
        setPage(res.data);
      })
      .catch(() => {
        setError('Failed to load page');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  // Save as draft (no publish)
  const saveDraft = useCallback(
    async (data: Data) => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      setSaving(true);
      try {
        await apiFetch(`/api/pages/${id}`, {
          method: 'PUT',
          body: { data },
        });
        // Show "Saved" indicator briefly
        setShowSaved(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setShowSaved(false), SAVED_INDICATOR_DURATION);
      } catch {
        // Silently fail for auto-save — don't disrupt the user
      } finally {
        isSavingRef.current = false;
        setSaving(false);
      }
    },
    [id]
  );

  // Cleanup the "Saved" indicator timer on unmount.
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // Save on page unload / navigation
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (latestDataRef.current) {
        const body = JSON.stringify({ data: latestDataRef.current });
        navigator.sendBeacon(
          `/api/pages/${id}`,
          new Blob([body], { type: 'application/json' })
        );
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [id]);

  // Track data changes from Puck
  const handleChange = useCallback((data: Data) => {
    latestDataRef.current = data;
  }, []);

  // Publish handler — save draft first, then publish
  const handlePublish = useCallback(
    async (data: Data) => {
      setSaving(true);
      setError(null);
      try {
        // Save the latest data
        await apiFetch(`/api/pages/${id}`, {
          method: 'PUT',
          body: { data },
        });
        // Then publish
        await apiFetch(`/api/pages/${id}/publish`, {
          method: 'POST',
        });
        setShowSaved(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setShowSaved(false), SAVED_INDICATOR_DURATION);
      } catch {
        setError('Failed to publish page');
      } finally {
        setSaving(false);
      }
    },
    [id]
  );

  if (loading) {
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

  const rawPageData = (page?.data as PageData) ?? {
    root: { props: {} },
    content: [],
  };
  // Memoize so transient parent re-renders (e.g. toggling the "Saved"
  // indicator) don't hand Puck a fresh `data` reference and cause it to
  // re-mount mid-edit (which would lose focus / collapse open panels).
  const { data: pageData, removed: removedTypes } = useMemo(
    () => sanitizePageData(rawPageData),
    // We intentionally re-derive only when the loaded page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page]
  );

  const overrides = createOverrides(defaultTheme);
  const plugins = createEditorPlugins({
    onPublish: () => {
      if (latestDataRef.current) {
        handlePublish(latestDataRef.current);
      }
    },
  });

  return (
    <div className="-m-8" style={{ height: '100vh', width: 'calc(100% + 4rem)' }}>
      {/* Back link + Save status */}
      <div className="fixed top-2 left-2 z-[9999] flex items-center gap-2">
        <Link
          href={`/ora-panel/pages/${id}`}
          className="flex h-8 items-center gap-1.5 bg-ora-charcoal/80 px-3 text-xs text-white hover:bg-ora-charcoal transition-colors backdrop-blur-sm"
        >
          ← Back
        </Link>
        <button
          type="button"
          onClick={() => {
            if (latestDataRef.current) saveDraft(latestDataRef.current);
          }}
          disabled={saving}
          className="flex h-8 items-center gap-1.5 bg-ora-cream px-3 text-xs text-ora-charcoal hover:bg-ora-cream-dark transition-colors disabled:opacity-50"
          title="Save draft (auto-save is off)"
        >
          Save Draft
        </button>
      </div>
      {saving && (
        <div className="fixed top-4 right-4 z-[9999] bg-ora-charcoal px-4 py-2 text-sm text-white">
          Saving…
        </div>
      )}
      {showSaved && !saving && (
        <div
          className="fixed top-4 right-4 z-[9999] bg-ora-success/90 px-4 py-2 text-sm text-white transition-opacity duration-500"
        >
          Saved
        </div>
      )}
      {error && page && (
        <div className="fixed top-4 right-4 z-[9999] flex items-center gap-3 bg-ora-error px-4 py-2 text-sm text-white">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-white/70 hover:text-white">✕</button>
        </div>
      )}
      {removedTypes.length > 0 && (
        <div className="fixed top-14 right-4 z-[9998] max-w-md bg-amber-600 px-4 py-2 text-xs text-white">
          Removed {removedTypes.length} unsupported block
          {removedTypes.length === 1 ? '' : 's'} ({Array.from(new Set(removedTypes)).join(', ')}).
          Save the page to make this permanent.
        </div>
      )}

      <Puck
        config={pageBuilderConfig}
        data={pageData as unknown as Data}
        onChange={handleChange}
        onPublish={handlePublish}
        overrides={overrides}
        plugins={plugins}
      />
    </div>
  );
}
