'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Save, Trash2 } from 'lucide-react';
import { DetailPageSkeleton } from '@/components/ui/panel-skeletons';

const SOURCE_TYPES = ['manual', 'blog_sync', 'construction_update', 'faq', 'policy'] as const;

export default function EditKnowledgeDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: doc, isLoading } = useQuery({
    queryKey: ['ai-knowledge-doc', id],
    queryFn: () => fetch(`/api/ai/knowledge-base/${id}`).then((r) => r.json()),
  });

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sourceType, setSourceType] = useState('manual');
  const [category, setCategory] = useState('');
  const [locale, setLocale] = useState<'en' | 'ar'>('en');
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!doc) return;
    const d = doc.document ?? doc;
    setTitle(d.title ?? '');
    setContent(d.content ?? '');
    setSourceType(d.sourceType ?? 'manual');
    setCategory(d.category ?? '');
    setLocale(d.locale ?? 'en');
  }, [doc]);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch(`/api/ai/knowledge-base/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to update');
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-knowledge-doc', id] });
      queryClient.invalidateQueries({ queryKey: ['ai-knowledge-base'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const remove = useMutation({
    mutationFn: () =>
      fetch(`/api/ai/knowledge-base/${id}`, { method: 'DELETE' }).then((r) => {
        if (!r.ok) throw new Error('Failed to delete');
        return r.json();
      }),
    onSuccess: () => router.push('/ora-panel/ai/knowledge-base'),
  });

  const handleSave = () => {
    if (!title.trim() || !content.trim()) return;
    update.mutate({ title: title.trim(), content: content.trim(), sourceType, category: category.trim() || undefined, locale });
  };

  if (isLoading) {
    return <DetailPageSkeleton fieldsPerSection={6} />;
  }

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/ai/knowledge-base" className="hover:text-ora-charcoal transition-colors">AI Knowledge Base</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">Edit Document</span>
      </nav>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Edit Document</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Update knowledge base document</p>
        </div>
        {confirmDelete ? (
          <div className="flex gap-2">
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="h-10 bg-ora-error px-6 text-sm text-ora-white hover:bg-ora-error/90 transition-colors"
            >
              Confirm Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="h-10 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex h-10 items-center gap-2 bg-ora-error/10 px-6 text-sm text-ora-error hover:bg-ora-error/20 transition-colors"
          >
            <Trash2 className="h-4 w-4 stroke-1" />
            Delete
          </button>
        )}
      </div>

      <div className="max-w-2xl space-y-6">
        <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Content</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
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
          {saved && <span className="text-sm text-ora-success">Saved</span>}
          {update.isError && <span className="text-sm text-ora-error">Failed to save.</span>}
          <button
            onClick={handleSave}
            disabled={update.isPending || !title.trim() || !content.trim()}
            className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5 stroke-1" />
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
