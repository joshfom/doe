'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useCommunity,
  useUpdateCommunity,
} from '@/lib/cms/hooks/use-communities';
import { ArrowLeft } from 'lucide-react';

export default function EditCommunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: community, isLoading } = useCommunity(id);
  const updateCommunity = useUpdateCommunity(id);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    slug: '',
    nameEn: '',
    nameAr: '',
    descriptionEn: '',
    descriptionAr: '',
    status: 'active' as 'active' | 'inactive' | 'archived',
  });

  useEffect(() => {
    if (community) {
      setForm({
        slug: community.slug,
        nameEn: community.nameEn,
        nameAr: community.nameAr ?? '',
        descriptionEn: community.descriptionEn ?? '',
        descriptionAr: community.descriptionAr ?? '',
        status: community.status,
      });
    }
  }, [community]);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await updateCommunity.mutateAsync({
        slug: form.slug.trim(),
        nameEn: form.nameEn.trim(),
        nameAr: form.nameAr.trim() || null,
        descriptionEn: form.descriptionEn.trim() || null,
        descriptionAr: form.descriptionAr.trim() || null,
        region: 'Bayn',
        status: form.status,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      const e = err as { error?: string };
      setError(e.error ?? 'Failed to update');
    }
  }

  if (isLoading) {
    return <div className="h-32 animate-pulse bg-ora-sand/40" />;
  }
  if (!community) {
    return <div className="text-sm text-ora-error">Community not found.</div>;
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/ora-panel/communities"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ora-charcoal-light hover:text-ora-charcoal"
      >
        <ArrowLeft className="h-3 w-3 stroke-1" /> Back to Communities
      </Link>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ora-charcoal">{community.nameEn}</h1>
        <Link
          href={`/ora-panel/projects?communityId=${community.id}`}
          className="inline-flex h-9 items-center border border-ora-sand bg-ora-white px-4 text-sm text-ora-charcoal hover:bg-ora-cream"
        >
          View Projects →
        </Link>
      </div>

      <form onSubmit={onSubmit} className="space-y-4 border border-ora-sand bg-ora-white p-6">
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
            onChange={(e) => update('status', e.target.value as typeof form.status)}
            className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="archived">Archived</option>
          </select>
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

        <Field label="Description (English)">
          <textarea
            value={form.descriptionEn}
            onChange={(e) => update('descriptionEn', e.target.value)}
            className="min-h-24 w-full border border-ora-sand bg-ora-white p-3 text-sm"
          />
        </Field>

        <Field label="Description (Arabic)">
          <textarea
            value={form.descriptionAr}
            onChange={(e) => update('descriptionAr', e.target.value)}
            dir="rtl"
            className="min-h-24 w-full border border-ora-sand bg-ora-white p-3 text-sm"
          />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="submit"
            disabled={updateCommunity.isPending}
            className="inline-flex h-10 items-center bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite disabled:opacity-50"
          >
            {updateCommunity.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
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
