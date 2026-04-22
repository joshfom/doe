'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import '@puckeditor/core/dist/index.css';
import { Puck } from '@puckeditor/core';
import type { Data } from '@puckeditor/core';
import { pageBuilderConfig } from '@/lib/page-builder/config';
import { createOverrides } from '@/lib/page-builder/components/ui-overrides';
import { defaultTheme } from '@/lib/page-builder/theme';
import type { PageData } from '@/lib/page-builder/types';
import { apiFetch } from '@/lib/cms/hooks/api';

const AUTO_SAVE_INTERVAL = 30_000; // 30 seconds
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

  // Ref to track the latest editor data for auto-save and beforeunload
  const latestDataRef = useRef<Data | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  // Auto-save every 30 seconds
  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      if (latestDataRef.current) {
        saveDraft(latestDataRef.current);
      }
    }, AUTO_SAVE_INTERVAL);

    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, [saveDraft]);

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

  const pageData = (page?.data as PageData) ?? {
    root: { props: {} },
    content: [],
  };

  const overrides = createOverrides(defaultTheme);

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

      <Puck
        config={pageBuilderConfig}
        data={pageData as unknown as Data}
        onChange={handleChange}
        onPublish={handlePublish}
        overrides={overrides}
      />
    </div>
  );
}
