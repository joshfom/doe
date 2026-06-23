'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import {
  useCommunities,
  useCreateProject,
} from '@/lib/cms/hooks/use-communities';

function NewProjectContent() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialCommunityId = sp.get('communityId') ?? '';
  const { data: communities } = useCommunities();
  const createProject = useCreateProject();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(
    null
  );

  const [form, setForm] = useState({
    communityId: initialCommunityId,
    slug: '',
    nameEn: '',
    nameAr: '',
    shortDescriptionEn: '',
    expectedHandoverDate: '',
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors(null);
    try {
      const created = await createProject.mutateAsync({
        communityId: form.communityId,
        slug: form.slug.trim(),
        nameEn: form.nameEn.trim(),
        nameAr: form.nameAr.trim() || undefined,
        shortDescriptionEn: form.shortDescriptionEn.trim() || undefined,
        developer: 'ORA Developers',
        expectedHandoverDate: form.expectedHandoverDate || undefined,
      });
      router.push(`/ora-panel/projects/${created.id}`);
    } catch (err) {
      const e = err as { error?: string; details?: Record<string, string> };
      setError(e.error ?? 'Failed to create project');
      setFieldErrors(e.details ?? null);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/ora-panel/projects"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ora-charcoal-light hover:text-ora-charcoal"
      >
        <ArrowLeft className="h-3 w-3 stroke-1" /> Back to Projects
      </Link>
      <h1 className="mb-6 text-2xl font-semibold text-ora-charcoal">New Project</h1>

      <form onSubmit={onSubmit} className="space-y-4 border border-ora-sand bg-ora-white p-6">
        {error && (
          <div className="border border-ora-error/40 bg-ora-error/10 p-3 text-sm text-ora-error">
            <p className="font-medium">{error}</p>
            {fieldErrors && Object.keys(fieldErrors).length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {Object.entries(fieldErrors).map(([field, message]) => (
                  <li key={field}>
                    <span className="font-medium">{field}</span>: {message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Field label="Community *">
          <select
            required
            value={form.communityId}
            onChange={(e) => update('communityId', e.target.value)}
            className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
          >
            <option value="">Select a community…</option>
            {communities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEn}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Slug *" hint="unique within the community">
          <input
            required
            value={form.slug}
            onChange={(e) => update('slug', e.target.value)}
            className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
            placeholder="park-heights-residences"
          />
        </Field>

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

        <Field label="Short description (English)">
          <textarea
            value={form.shortDescriptionEn}
            onChange={(e) => update('shortDescriptionEn', e.target.value)}
            className="min-h-20 w-full border border-ora-sand bg-ora-white p-3 text-sm"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected handover">
            <input
              type="date"
              value={form.expectedHandoverDate}
              onChange={(e) => update('expectedHandoverDate', e.target.value)}
              className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
            />
          </Field>
        </div>

        <p className="text-xs text-ora-muted">
          Brochure media, floorplans, amenities and payment plans can be added on the next screen after creation.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/ora-panel/projects"
            className="inline-flex h-10 items-center border border-ora-sand bg-ora-white px-6 text-sm text-ora-charcoal hover:bg-ora-cream"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createProject.isPending}
            className="inline-flex h-10 items-center bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite disabled:opacity-50"
          >
            {createProject.isPending ? 'Creating…' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function NewProjectPage() {
  return (
    <Suspense fallback={<div className="h-32 animate-pulse bg-ora-sand/40" />}>
      <NewProjectContent />
    </Suspense>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-ora-muted">
        {label}
        {hint && <span className="ml-2 normal-case text-[10px] text-ora-muted">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
