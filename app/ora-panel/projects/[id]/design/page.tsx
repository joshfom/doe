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
 * Default project landing page template.
 * Uses the actual Puck component prop schemas to create a real-estate style layout:
 * - Hero section (dark bg, full height, bottom-aligned content)
 * - Overview section (white bg, centered text)
 * - Gallery section (cream bg)
 * - Features/key facts section (white bg)
 * - Contact CTA section (charcoal bg)
 */
function getDefaultTemplate(): PageData {
  return {
    root: { props: { title: 'Project Landing Page' } },
    content: [
      {
        type: 'Section',
        props: {
          id: 'hero-section',
          sectionId: 'hero',
          bgMode: 'solid',
          bgMediaType: 'none',
          bgColor: '#2C2C2C',
          bgImage: '',
          bgPosition: 'center center',
          bgVideoUrl: '',
          bgVideoPosition: 'center center',
          bgVideoAutoplay: 'yes',
          bgVideoLoop: 'yes',
          bgVideoSound: 'off',
          bgVideoControls: 'no',
          bgVideoFit: 'cover',
          bgVideoPoster: '',
          bgOpacity: '1',
          gradientFrom: '#1A1A1A',
          gradientTo: '#2C2C2C',
          gradientDirection: 'to bottom',
          textColor: '#FFFFFF',
          minHeight: '75vh',
          maxHeight: 'auto',
          contentAlign: 'flex-end',
          _padding: { paddingTop: '80', paddingBottom: '80', paddingLeft: '40', paddingRight: '40' },
          _margin: { marginTop: '0', marginBottom: '0' },
          _border: {},
        },
      },
      {
        type: 'Section',
        props: {
          id: 'overview-section',
          sectionId: 'overview',
          bgMode: 'solid',
          bgMediaType: 'none',
          bgColor: '#FFFFFF',
          bgImage: '',
          bgPosition: 'center center',
          bgVideoUrl: '',
          bgVideoPosition: 'center center',
          bgVideoAutoplay: 'yes',
          bgVideoLoop: 'yes',
          bgVideoSound: 'off',
          bgVideoControls: 'no',
          bgVideoFit: 'cover',
          bgVideoPoster: '',
          bgOpacity: '1',
          gradientFrom: '#1A1A1A',
          gradientTo: '#2C2C2C',
          gradientDirection: 'to bottom',
          textColor: 'auto',
          minHeight: 'auto',
          maxHeight: 'auto',
          contentAlign: 'flex-start',
          _padding: { paddingTop: '80', paddingBottom: '80', paddingLeft: '40', paddingRight: '40' },
          _margin: { marginTop: '0', marginBottom: '0' },
          _border: {},
        },
      },
      {
        type: 'Section',
        props: {
          id: 'gallery-section',
          sectionId: 'gallery',
          bgMode: 'solid',
          bgMediaType: 'none',
          bgColor: '#F8F6F2',
          bgImage: '',
          bgPosition: 'center center',
          bgVideoUrl: '',
          bgVideoPosition: 'center center',
          bgVideoAutoplay: 'yes',
          bgVideoLoop: 'yes',
          bgVideoSound: 'off',
          bgVideoControls: 'no',
          bgVideoFit: 'cover',
          bgVideoPoster: '',
          bgOpacity: '1',
          gradientFrom: '#1A1A1A',
          gradientTo: '#2C2C2C',
          gradientDirection: 'to bottom',
          textColor: 'auto',
          minHeight: 'auto',
          maxHeight: 'auto',
          contentAlign: 'flex-start',
          _padding: { paddingTop: '80', paddingBottom: '80', paddingLeft: '40', paddingRight: '40' },
          _margin: { marginTop: '0', marginBottom: '0' },
          _border: {},
        },
      },
      {
        type: 'Section',
        props: {
          id: 'features-section',
          sectionId: 'features',
          bgMode: 'solid',
          bgMediaType: 'none',
          bgColor: '#FFFFFF',
          bgImage: '',
          bgPosition: 'center center',
          bgVideoUrl: '',
          bgVideoPosition: 'center center',
          bgVideoAutoplay: 'yes',
          bgVideoLoop: 'yes',
          bgVideoSound: 'off',
          bgVideoControls: 'no',
          bgVideoFit: 'cover',
          bgVideoPoster: '',
          bgOpacity: '1',
          gradientFrom: '#1A1A1A',
          gradientTo: '#2C2C2C',
          gradientDirection: 'to bottom',
          textColor: 'auto',
          minHeight: 'auto',
          maxHeight: 'auto',
          contentAlign: 'flex-start',
          _padding: { paddingTop: '80', paddingBottom: '80', paddingLeft: '40', paddingRight: '40' },
          _margin: { marginTop: '0', marginBottom: '0' },
          _border: {},
        },
      },
      {
        type: 'Section',
        props: {
          id: 'cta-section',
          sectionId: 'contact',
          bgMode: 'solid',
          bgMediaType: 'none',
          bgColor: '#2C2C2C',
          bgImage: '',
          bgPosition: 'center center',
          bgVideoUrl: '',
          bgVideoPosition: 'center center',
          bgVideoAutoplay: 'yes',
          bgVideoLoop: 'yes',
          bgVideoSound: 'off',
          bgVideoControls: 'no',
          bgVideoFit: 'cover',
          bgVideoPoster: '',
          bgOpacity: '1',
          gradientFrom: '#1A1A1A',
          gradientTo: '#2C2C2C',
          gradientDirection: 'to bottom',
          textColor: '#FFFFFF',
          minHeight: 'auto',
          maxHeight: 'auto',
          contentAlign: 'center',
          _padding: { paddingTop: '80', paddingBottom: '80', paddingLeft: '40', paddingRight: '40' },
          _margin: { marginTop: '0', marginBottom: '0' },
          _border: {},
        },
      },
    ],
    zones: {
      'hero-section:default': [
        {
          type: 'Heading',
          props: {
            id: 'hero-community',
            text: 'COMMUNITY NAME',
            level: 'h6',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '12',
            textAlign: 'left',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'uppercase',
            lineHeight: 'auto',
            letterSpacing: '0.2em',
            color: '#B8956B',
            _padding: { paddingTop: '0', paddingBottom: '8', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
        {
          type: 'Heading',
          props: {
            id: 'hero-title',
            text: 'Project Name',
            level: 'h1',
            fontFamily: 'inherit',
            fontWeight: '300',
            fontSize: '56',
            textAlign: 'left',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: 'auto',
            letterSpacing: 'normal',
            color: '#FFFFFF',
            _padding: { paddingTop: '0', paddingBottom: '16', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
        {
          type: 'Text',
          props: {
            id: 'hero-subtitle',
            content: '<p>A brief description of the project. Edit this to match your project details.</p>',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '18',
            textAlign: 'left',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: 'auto',
            letterSpacing: 'normal',
            color: '#FFFFFF',
            _padding: { paddingTop: '0', paddingBottom: '0', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
      ],
      'overview-section:default': [
        {
          type: 'Container',
          props: {
            id: 'overview-container',
            maxWidth: '960',
            bgMode: 'solid',
            bgColor: 'transparent',
            gradientFrom: '#F9F7F5',
            gradientTo: '#EBE7E2',
            gradientDirection: 'to bottom',
            textColor: 'auto',
            contentAlign: 'flex-start',
            _padding: { paddingTop: '0', paddingBottom: '0', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
      ],
      'overview-container:default': [
        {
          type: 'Heading',
          props: {
            id: 'overview-label',
            text: 'THE PROJECT',
            level: 'h6',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '11',
            textAlign: 'left',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'uppercase',
            lineHeight: 'auto',
            letterSpacing: '0.15em',
            color: '#4A4A4A',
            _padding: { paddingTop: '0', paddingBottom: '16', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
        {
          type: 'Heading',
          props: {
            id: 'overview-heading',
            text: 'Project Name',
            level: 'h2',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '36',
            textAlign: 'left',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: 'auto',
            letterSpacing: 'normal',
            color: '#1A1A1A',
            _padding: { paddingTop: '0', paddingBottom: '24', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
        {
          type: 'Text',
          props: {
            id: 'overview-text',
            content: '<p>Add your project overview here. Describe the vision, the location, and what makes this development unique. This section supports rich text formatting.</p>',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '16',
            textAlign: 'left',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: '1.8',
            letterSpacing: 'normal',
            color: '#4A4A4A',
            _padding: { paddingTop: '0', paddingBottom: '0', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
      ],
      'gallery-section:default': [
        {
          type: 'Heading',
          props: {
            id: 'gallery-heading',
            text: 'Gallery',
            level: 'h2',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '36',
            textAlign: 'left',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: 'auto',
            letterSpacing: 'normal',
            color: '#1A1A1A',
            _padding: { paddingTop: '0', paddingBottom: '32', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
        {
          type: 'Text',
          props: {
            id: 'gallery-placeholder',
            content: '<p>Add Image blocks here to build your project gallery.</p>',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '14',
            textAlign: 'left',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: 'auto',
            letterSpacing: 'normal',
            color: '#4A4A4A',
            _padding: { paddingTop: '0', paddingBottom: '0', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
      ],
      'features-section:default': [
        {
          type: 'Heading',
          props: {
            id: 'features-heading',
            text: 'Key Features',
            level: 'h2',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '36',
            textAlign: 'center',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: 'auto',
            letterSpacing: 'normal',
            color: '#1A1A1A',
            _padding: { paddingTop: '0', paddingBottom: '32', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
        {
          type: 'Text',
          props: {
            id: 'features-placeholder',
            content: '<p>Add StatsGrid, IconFeatureList, or Columns blocks to showcase project features, unit types, and pricing.</p>',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '14',
            textAlign: 'center',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: 'auto',
            letterSpacing: 'normal',
            color: '#4A4A4A',
            _padding: { paddingTop: '0', paddingBottom: '0', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
      ],
      'cta-section:default': [
        {
          type: 'Heading',
          props: {
            id: 'cta-heading',
            text: 'Interested in this project?',
            level: 'h2',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '32',
            textAlign: 'center',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: 'auto',
            letterSpacing: 'normal',
            color: '#FFFFFF',
            _padding: { paddingTop: '0', paddingBottom: '16', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
        {
          type: 'Text',
          props: {
            id: 'cta-text',
            content: '<p>Get in touch with our sales team for more information.</p>',
            fontFamily: 'inherit',
            fontWeight: '400',
            fontSize: '16',
            textAlign: 'center',
            fontStyle: 'normal',
            textDecoration: 'none',
            textTransform: 'none',
            lineHeight: 'auto',
            letterSpacing: 'normal',
            color: '#FFFFFF',
            _padding: { paddingTop: '0', paddingBottom: '24', paddingLeft: '0', paddingRight: '0' },
            _margin: { marginTop: '0', marginBottom: '0' },
            _border: {},
          },
        },
        {
          type: 'Button',
          props: {
            id: 'cta-button',
            text: 'Register Interest',
            url: '#contact',
            _icon: { name: '', position: 'right', size: '16', gap: '8px' },
            _typography: {
              fontFamily: 'inherit',
              fontWeight: '600',
              fontSize: '14px',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            },
            textColor: '#2C2C2C',
            textColorHover: '#FFFFFF',
            bgColor: '#B8956B',
            bgColorHover: '#9A7A5A',
            borderColor: '#B8956B',
            borderColorHover: '#B8956B',
            borderSize: '0',
            borderRadius: '0',
            btnPadding: { top: 14, right: 32, bottom: 14, left: 32 },
            _margin: { marginTop: '0', marginBottom: '0' },
            fullWidth: 'no',
            alignment: 'center',
          },
        },
      ],
    },
  };
}

/**
 * Strip components whose `type` is no longer registered so the canvas
 * never renders "No configuration for X" placeholders.
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

const SAVED_INDICATOR_DURATION = 2_000;

export default function ProjectDesignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const latestDataRef = useRef<Data | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSavingRef = useRef(false);

  // Load project data
  useEffect(() => {
    apiFetch<{ data: Record<string, unknown> }>(`/api/projects/${id}`)
      .then((res) => {
        setProject(res.data);
      })
      .catch(() => {
        setError('Failed to load project');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  // Save landing page data to the project
  const saveDraft = useCallback(
    async (data: Data) => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      setSaving(true);
      try {
        await apiFetch(`/api/projects/${id}`, {
          method: 'PATCH',
          body: { landingPageData: data },
        });
        setShowSaved(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setShowSaved(false), SAVED_INDICATOR_DURATION);
      } catch {
        setError('Failed to save landing page');
      } finally {
        isSavingRef.current = false;
        setSaving(false);
      }
    },
    [id]
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // Save on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (latestDataRef.current) {
        const body = JSON.stringify({ landingPageData: latestDataRef.current });
        navigator.sendBeacon(
          `/api/projects/${id}`,
          new Blob([body], { type: 'application/json' })
        );
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [id]);

  // Track data changes
  const handleChange = useCallback((data: Data) => {
    latestDataRef.current = data;
  }, []);

  // Publish = save
  const handlePublish = useCallback(
    async (data: Data) => {
      await saveDraft(data);
    },
    [saveDraft]
  );

  // Use existing landing page data or load the default template
  // Must be above early returns to maintain consistent hook order
  const { data: pageData, removed: removedTypes } = useMemo(() => {
    const rawPageData = (project?.landingPageData as PageData) ?? getDefaultTemplate();
    return sanitizePageData(rawPageData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-ora-muted">Loading designer…</p>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-ora-error">{error}</p>
        <button
          onClick={() => router.push(`/ora-panel/projects/${id}`)}
          className="h-10 bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
        >
          Back to Project
        </button>
      </div>
    );
  }

  const overrides = createOverrides(defaultTheme);
  const plugins = createEditorPlugins({
    onPublish: () => {
      if (latestDataRef.current) {
        handlePublish(latestDataRef.current);
      }
    },
  });

  const projectName = (project?.nameEn as string) || 'Project';

  return (
    <div className="-m-8" style={{ height: '100vh', width: 'calc(100% + 4rem)' }}>
      {/* Back link + Save status */}
      <div className="fixed top-2 left-2 z-[9999] flex items-center gap-2">
        <Link
          href={`/ora-panel/projects/${id}`}
          className="flex h-8 items-center gap-1.5 bg-ora-charcoal/80 px-3 text-xs text-white hover:bg-ora-charcoal transition-colors backdrop-blur-sm"
        >
          ← {projectName}
        </Link>
        <button
          type="button"
          onClick={() => {
            if (latestDataRef.current) saveDraft(latestDataRef.current);
          }}
          disabled={saving}
          className="flex h-8 items-center gap-1.5 bg-ora-cream px-3 text-xs text-ora-charcoal hover:bg-ora-cream-dark transition-colors disabled:opacity-50"
          title="Save landing page design"
        >
          Save Design
        </button>
      </div>
      {saving && (
        <div className="fixed top-4 right-4 z-[9999] bg-ora-charcoal px-4 py-2 text-sm text-white">
          Saving…
        </div>
      )}
      {showSaved && !saving && (
        <div className="fixed top-4 right-4 z-[9999] bg-ora-success/90 px-4 py-2 text-sm text-white transition-opacity duration-500">
          Saved
        </div>
      )}
      {error && project && (
        <div className="fixed top-4 right-4 z-[9999] flex items-center gap-3 bg-ora-error px-4 py-2 text-sm text-white">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-white/70 hover:text-white">✕</button>
        </div>
      )}
      {removedTypes.length > 0 && (
        <div className="fixed top-14 right-4 z-[9998] max-w-md bg-amber-600 px-4 py-2 text-xs text-white">
          Removed {removedTypes.length} unsupported block
          {removedTypes.length === 1 ? '' : 's'} ({Array.from(new Set(removedTypes)).join(', ')}).
          Save to make this permanent.
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
