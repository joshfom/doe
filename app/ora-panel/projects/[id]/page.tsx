'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import {
  useProject,
  useUpdateProject,
} from '@/lib/cms/hooks/use-communities';
import { useSiteSettings } from '@/lib/cms/hooks';
import type {
  ProjectAmenity,
  ProjectFloorplan,
  ProjectLocationHighlight,
  ProjectPaymentPlan,
  ProjectStatus,
} from '@/lib/cms/types';
import {
  MediaIdPicker,
  MediaIdGallery,
} from '@/lib/cms/components/MediaIdPicker';
import {
  AmenityEditor,
  FloorplanEditor,
  LocationHighlightEditor,
  PaymentPlanEditor,
} from './project-editors';

const PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'pre_launch',
  'selling',
  'under_construction',
  'handover',
  'completed',
  'archived',
];

interface FormState {
  slug: string;
  nameEn: string;
  nameAr: string;
  shortDescriptionEn: string;
  shortDescriptionAr: string;
  longDescriptionEn: string;
  longDescriptionAr: string;
  status: ProjectStatus;
  contractor: string;
  architect: string;
  expectedHandoverDate: string;
  totalUnits: string;
  availableUnits: string;
  brochurePdfId: string;
  heroImageId: string;
  logoImageId: string;
  brochureGallery: string[];
  floorplans: ProjectFloorplan[];
  amenities: ProjectAmenity[];
  locationHighlights: ProjectLocationHighlight[];
  paymentPlans: ProjectPaymentPlan[];
}

export default function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: project, isLoading } = useProject(id);
  const updateProject = useUpdateProject(id);
  const { data: settingsEntries } = useSiteSettings();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState<FormState>({
    slug: '',
    nameEn: '',
    nameAr: '',
    shortDescriptionEn: '',
    shortDescriptionAr: '',
    longDescriptionEn: '',
    longDescriptionAr: '',
    status: 'planning',
    contractor: '',
    architect: '',
    expectedHandoverDate: '',
    totalUnits: '',
    availableUnits: '',
    brochurePdfId: '',
    heroImageId: '',
    logoImageId: '',
    brochureGallery: [],
    floorplans: [],
    amenities: [],
    locationHighlights: [],
    paymentPlans: [],
  });

  useEffect(() => {
    if (!project) return;
    setForm({
      slug: project.slug,
      nameEn: project.nameEn,
      nameAr: project.nameAr ?? '',
      shortDescriptionEn: project.shortDescriptionEn ?? '',
      shortDescriptionAr: project.shortDescriptionAr ?? '',
      longDescriptionEn: project.longDescriptionEn ?? '',
      longDescriptionAr: project.longDescriptionAr ?? '',
      status: project.status,
      contractor: project.contractor ?? '',
      architect: project.architect ?? '',
      expectedHandoverDate: project.expectedHandoverDate ?? '',
      totalUnits: project.totalUnits?.toString() ?? '',
      availableUnits: project.availableUnits?.toString() ?? '',
      brochurePdfId: project.brochurePdfId ?? '',
      heroImageId: project.heroImageId ?? '',
      logoImageId: project.logoImageId ?? '',
      brochureGallery: project.brochureGallery ?? [],
      floorplans: project.floorplans ?? [],
      amenities: project.amenities ?? [],
      locationHighlights: project.locationHighlights ?? [],
      paymentPlans: project.paymentPlans ?? [],
    });
  }, [project]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    try {
      await updateProject.mutateAsync({
        slug: form.slug.trim(),
        nameEn: form.nameEn.trim(),
        nameAr: form.nameAr.trim() || null,
        shortDescriptionEn: form.shortDescriptionEn.trim() || null,
        shortDescriptionAr: form.shortDescriptionAr.trim() || null,
        longDescriptionEn: form.longDescriptionEn.trim() || null,
        longDescriptionAr: form.longDescriptionAr.trim() || null,
        status: form.status,
        developer: 'ORA Developers',
        contractor: form.contractor.trim() || null,
        architect: form.architect.trim() || null,
        expectedHandoverDate: form.expectedHandoverDate || null,
        totalUnits: form.totalUnits ? Number(form.totalUnits) : null,
        availableUnits: form.availableUnits ? Number(form.availableUnits) : null,
        brochurePdfId: form.brochurePdfId.trim() || null,
        heroImageId: form.heroImageId.trim() || null,
        logoImageId: form.logoImageId.trim() || null,
        brochureGallery: form.brochureGallery,
        floorplans: form.floorplans,
        amenities: form.amenities,
        locationHighlights: form.locationHighlights,
        paymentPlans: form.paymentPlans,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      const e = err as { error?: string; message?: string };
      setError(e.error ?? e.message ?? 'Failed to update');
    }
  }

  if (isLoading) {
    return <div className="h-32 animate-pulse bg-ora-sand/40" />;
  }
  if (!project) {
    return <div className="text-sm text-ora-error">Project not found.</div>;
  }

  return (
    <div className="max-w-3xl">
      <Link
        href="/ora-panel/projects"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ora-charcoal-light hover:text-ora-charcoal"
      >
        <ArrowLeft className="h-3 w-3 stroke-1" /> Back to Projects
      </Link>
      <h1 className="mb-6 text-2xl font-semibold text-ora-charcoal">{project.nameEn}</h1>
      <ViewLiveLinks slug={project.slug} settingsEntries={settingsEntries} />

      <form onSubmit={onSubmit} className="space-y-6">
        {error && (
          <div className="border border-ora-error/40 bg-ora-error/10 p-3 text-sm text-ora-error">
            {error}
          </div>
        )}
        {saved && (
          <div className="border border-ora-success/40 bg-ora-success/10 p-3 text-sm text-ora-success">
            Changes saved.
          </div>
        )}

        <Section title="Basics">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Slug *">
              <input
                required
                value={form.slug}
                onChange={(e) => update('slug', e.target.value)}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => update('status', e.target.value as ProjectStatus)}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              >
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Name (English) *">
            <input
              required
              value={form.nameEn}
              onChange={(e) => update('nameEn', e.target.value)}
              className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
            />
          </Field>
          <Field label="Name (Arabic)">
            <input
              value={form.nameAr}
              onChange={(e) => update('nameAr', e.target.value)}
              dir="rtl"
              className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Short description (EN)">
              <textarea
                value={form.shortDescriptionEn}
                onChange={(e) => update('shortDescriptionEn', e.target.value)}
                className="min-h-20 w-full border border-ora-sand bg-ora-white p-3 text-sm"
              />
            </Field>
            <Field label="Short description (AR)">
              <textarea
                value={form.shortDescriptionAr}
                onChange={(e) => update('shortDescriptionAr', e.target.value)}
                dir="rtl"
                className="min-h-20 w-full border border-ora-sand bg-ora-white p-3 text-sm"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Long description (EN)">
              <textarea
                value={form.longDescriptionEn}
                onChange={(e) => update('longDescriptionEn', e.target.value)}
                className="min-h-32 w-full border border-ora-sand bg-ora-white p-3 text-sm"
              />
              <p className="mt-1 text-xs text-ora-muted">
                Blank line = new paragraph. Lines starting with &ldquo;- &rdquo; render as a bulleted list; &ldquo;1. &rdquo; as a numbered list.
              </p>
            </Field>
            <Field label="Long description (AR)">
              <textarea
                value={form.longDescriptionAr}
                onChange={(e) => update('longDescriptionAr', e.target.value)}
                dir="rtl"
                className="min-h-32 w-full border border-ora-sand bg-ora-white p-3 text-sm"
              />
            </Field>
          </div>
        </Section>

        <Section title="Stakeholders & timeline">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Contractor">
              <input
                value={form.contractor}
                onChange={(e) => update('contractor', e.target.value)}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              />
            </Field>
            <Field label="Architect">
              <input
                value={form.architect}
                onChange={(e) => update('architect', e.target.value)}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Expected handover">
              <input
                type="date"
                value={form.expectedHandoverDate}
                onChange={(e) => update('expectedHandoverDate', e.target.value)}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              />
            </Field>
            <Field label="Total units">
              <input
                type="number"
                min={0}
                value={form.totalUnits}
                onChange={(e) => update('totalUnits', e.target.value)}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              />
            </Field>
            <Field label="Available units">
              <input
                type="number"
                min={0}
                value={form.availableUnits}
                onChange={(e) => update('availableUnits', e.target.value)}
                className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Brochure media"
          subtitle="Pick images and PDFs from the Media library."
        >
          <div className="grid grid-cols-3 gap-4">
            <MediaIdPicker
              label="Hero image"
              value={form.heroImageId}
              onChange={(id) => update('heroImageId', id ?? '')}
              mimeTypeFilter="image/"
            />
            <MediaIdPicker
              label="Logo image"
              value={form.logoImageId}
              onChange={(id) => update('logoImageId', id ?? '')}
              mimeTypeFilter="image/"
            />
            <MediaIdPicker
              label="Brochure PDF"
              value={form.brochurePdfId}
              onChange={(id) => update('brochurePdfId', id ?? '')}
              mimeTypeFilter="application/pdf"
            />
          </div>

          <MediaIdGallery
            label="Brochure gallery"
            hint="Ordered list of gallery images"
            value={form.brochureGallery}
            onChange={(next) => update('brochureGallery', next)}
            mimeTypeFilter="image/"
          />
        </Section>

        <Section title="Floorplans">
          <FloorplanEditor
            value={form.floorplans}
            onChange={(next) => update('floorplans', next)}
          />
        </Section>

        <Section title="Amenities">
          <AmenityEditor
            value={form.amenities}
            onChange={(next) => update('amenities', next)}
          />
        </Section>

        <Section title="Location highlights">
          <LocationHighlightEditor
            value={form.locationHighlights}
            onChange={(next) => update('locationHighlights', next)}
          />
        </Section>

        <Section title="Payment plans">
          <PaymentPlanEditor
            value={form.paymentPlans}
            onChange={(next) => update('paymentPlans', next)}
          />
        </Section>

        <div className="flex justify-end gap-2">
          <button
            type="submit"
            disabled={updateProject.isPending}
            className="inline-flex h-10 items-center bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite disabled:opacity-50"
          >
            {updateProject.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-ora-sand bg-ora-white p-6">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ora-charcoal">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-xs text-ora-muted">{subtitle}</p>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ora-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function ViewLiveLinks({
  slug,
  settingsEntries,
}: {
  slug: string;
  settingsEntries: { key: string; value: string }[] | undefined;
}) {
  if (!slug) return null;
  const map: Record<string, string> = {};
  for (const e of settingsEntries ?? []) map[e.key] = e.value;
  const enPrefix = (map.project_slug_prefix || 'projects').trim();
  const arPrefix = (map.project_slug_prefix_ar || enPrefix).trim();
  const enHref = `/${enPrefix}/${slug}`;
  const arHref = `/ar/${arPrefix}/${slug}`;
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 text-xs">
      <span className="text-ora-muted uppercase tracking-wider">Live URLs:</span>
      <a
        href={enHref}
        target="_blank"
        rel="noopener noreferrer"
        className="border-b border-ora-gold pb-0.5 text-ora-gold hover:text-ora-charcoal"
      >
        {enHref}
      </a>
      <a
        href={arHref}
        target="_blank"
        rel="noopener noreferrer"
        className="border-b border-ora-gold pb-0.5 text-ora-gold hover:text-ora-charcoal"
      >
        {arHref}
      </a>
    </div>
  );
}
