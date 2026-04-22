'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreatePage } from '@/lib/cms/hooks';
import { generateSlug } from '@/lib/cms/utils/slug';
import type { Locale } from '@/lib/cms/types';

export default function NewPagePage() {
  const router = useRouter();
  const createPage = useCreatePage();

  const [title, setTitle] = useState('');
  const [locale, setLocale] = useState<Locale>('en');
  const [manualSlug, setManualSlug] = useState(false);
  const [slugOverride, setSlugOverride] = useState('');

  const autoSlug = generateSlug(title);
  const displaySlug = manualSlug ? slugOverride : autoSlug;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      const page = await createPage.mutateAsync({
        title: title.trim(),
        locale,
      });
      router.push(`/ora-panel/pages/${page.id}/edit`);
    } catch {
      // error handled by mutation state
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">New Page</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Create a new page</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Title */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            required
            className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>

        {/* Slug preview */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-medium text-ora-charcoal-light">Slug</label>
            <button
              type="button"
              onClick={() => {
                setManualSlug(!manualSlug);
                if (!manualSlug) setSlugOverride(autoSlug);
              }}
              className="text-xs text-ora-gold hover:text-ora-gold-dark transition-colors"
            >
              {manualSlug ? 'Use auto slug' : 'Override slug'}
            </button>
          </div>
          {manualSlug ? (
            <input
              type="text"
              value={slugOverride}
              onChange={(e) => setSlugOverride(e.target.value)}
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 font-mono text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          ) : (
            <div className="flex h-10 items-center border border-ora-sand bg-ora-cream-light px-4 font-mono text-sm text-ora-muted">
              /{displaySlug || '…'}
            </div>
          )}
        </div>

        {/* Locale */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
            Locale
          </label>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
            className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          >
            <option value="en">English (EN)</option>
            <option value="ar">Arabic (AR)</option>
          </select>
        </div>

        {/* Error */}
        {createPage.isError && (
          <p className="text-sm text-ora-error">
            Failed to create page. Please try again.
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={createPage.isPending || !title.trim()}
          className="h-10 w-full bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
        >
          {createPage.isPending ? 'Creating…' : 'Create Page'}
        </button>
      </form>
    </div>
  );
}
