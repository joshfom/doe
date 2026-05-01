'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { useCreateCommunity } from '@/lib/cms/hooks/use-communities';
import { ArrowLeft } from 'lucide-react';

export default function NewCommunityPage() {
  const router = useRouter();
  const createCommunity = useCreateCommunity();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    slug: '',
    nameEn: '',
    nameAr: '',
    descriptionEn: '',
    descriptionAr: '',
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await createCommunity.mutateAsync({
        slug: form.slug.trim(),
        nameEn: form.nameEn.trim(),
        nameAr: form.nameAr.trim() || undefined,
        descriptionEn: form.descriptionEn.trim() || undefined,
        descriptionAr: form.descriptionAr.trim() || undefined,
        region: 'Bayn',
      });
      router.push(`/ora-panel/communities/${created.id}`);
    } catch (err) {
      const e = err as { error?: string; details?: Record<string, string> };
      setError(e.error ?? 'Failed to create community');
    }
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/ora-panel/communities"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ora-charcoal-light hover:text-ora-charcoal"
      >
        <ArrowLeft className="h-3 w-3 stroke-1" /> Back to Communities
      </Link>
      <h1 className="mb-6 text-2xl font-semibold text-ora-charcoal">New Community</h1>

      <form onSubmit={onSubmit} className="space-y-4 border border-ora-sand bg-ora-white p-6">
        {error && (
          <div className="border border-ora-error/40 bg-ora-error/10 p-3 text-sm text-ora-error">
            {error}
          </div>
        )}

        <Field label="Slug *" hint="lowercase-with-hyphens">
          <input
            required
            value={form.slug}
            onChange={(e) => update('slug', e.target.value)}
            className="h-10 w-full border border-ora-sand bg-ora-white px-3 text-sm"
            placeholder="bayn-master-community"
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
          <Link
            href="/ora-panel/communities"
            className="inline-flex h-10 items-center border border-ora-sand bg-ora-white px-6 text-sm text-ora-charcoal hover:bg-ora-cream"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={createCommunity.isPending}
            className="inline-flex h-10 items-center bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite disabled:opacity-50"
          >
            {createCommunity.isPending ? 'Creating…' : 'Create Community'}
          </button>
        </div>
      </form>
    </div>
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
