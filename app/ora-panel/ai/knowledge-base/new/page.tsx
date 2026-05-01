'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { ChevronRight, Save } from 'lucide-react';

const SOURCE_TYPES = ['manual', 'blog_sync', 'construction_update', 'faq', 'policy'] as const;

export default function NewKnowledgeDocumentPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourceType, setSourceType] = useState<string>('manual');
  const [category, setCategory] = useState('');
  const [locale, setLocale] = useState<'en' | 'ar'>('en');

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch('/api/ai/knowledge-base', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to create document');
        return r.json();
      }),
    onSuccess: () => router.push('/ora-panel/ai/knowledge-base'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    create.mutate({ title: title.trim(), content: content.trim(), sourceType, category: category.trim() || undefined, locale });
  };

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/ai/knowledge-base" className="hover:text-ora-charcoal transition-colors">AI Knowledge Base</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">New Document</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">New Knowledge Document</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Add a new document to the AI knowledge base</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Document title"
              required
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Document content…"
              required
              rows={10}
              className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Source Type</label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              >
                {SOURCE_TYPES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Category</label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. payments"
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Locale</label>
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as 'en' | 'ar')}
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              >
                <option value="en">English</option>
                <option value="ar">Arabic</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {create.isError && <p className="text-sm text-ora-error">Failed to create document.</p>}
          <button
            type="submit"
            disabled={create.isPending || !title.trim() || !content.trim()}
            className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5 stroke-1" />
            {create.isPending ? 'Creating…' : 'Create Document'}
          </button>
        </div>
      </form>
    </div>
  );
}
