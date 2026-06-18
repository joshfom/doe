'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  useBlogTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
} from '@/lib/cms/hooks';
import { ChevronRight, Plus, Pencil, Trash2, X, Check, Search } from 'lucide-react';

export default function TagsPage() {
  const { data: tags, isLoading } = useBlogTags();
  const createTag = useCreateTag();
  const updateTag = useUpdateTag();
  const deleteTag = useDeleteTag();

  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const filtered = useMemo(() => {
    if (!tags) return [];
    if (!search) return tags;
    const q = search.toLowerCase();
    return tags.filter((t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q));
  }, [tags, search]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createTag.mutateAsync({ name: newName.trim() });
    setNewName('');
    setShowCreate(false);
  };

  const handleUpdate = async () => {
    if (!editId || !editName.trim()) return;
    await updateTag.mutateAsync({ id: editId, name: editName.trim() });
    setEditId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteTag.mutateAsync(id);
  };

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Feed</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/blog" className="hover:text-ora-charcoal transition-colors">Blog</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">Tags</span>
      </nav>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Tags</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Manage blog tags</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors">
          <Plus className="h-4 w-4 stroke-1" /> New Tag
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-4 flex items-center gap-3 border border-ora-sand/60 bg-ora-white p-4">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Tag name"
            className="h-10 flex-1 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <button onClick={handleCreate} disabled={createTag.isPending || !newName.trim()} className="h-10 bg-ora-gold px-6 text-sm text-ora-white hover:bg-ora-gold-dark transition-colors disabled:opacity-50">
            {createTag.isPending ? 'Creating…' : 'Create'}
          </button>
          <button onClick={() => { setShowCreate(false); setNewName(''); }} className="h-10 border border-ora-sand bg-ora-cream px-4 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">
            Cancel
          </button>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-1 text-ora-muted" />
          <input
            type="text"
            placeholder="Search tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full border border-ora-stone bg-ora-white pl-10 pr-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
      </div>

      {/* Tag list */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse bg-ora-sand/60" />)}</div>
      ) : !filtered.length ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center"><p className="text-sm text-ora-muted">{search ? 'No tags match your search' : 'No tags yet'}</p></div>
      ) : (
        <div className="border border-ora-sand/60 bg-ora-white">
          {filtered.map((tag) => (
            <div key={tag.id} className="flex items-center gap-3 border-b border-ora-sand/40 px-4 py-3 last:border-b-0 hover:bg-ora-cream-light transition-colors">
              {editId === tag.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="h-8 flex-1 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(); if (e.key === 'Escape') setEditId(null); }}
                  />
                  <button onClick={handleUpdate} disabled={updateTag.isPending} className="flex h-8 w-8 items-center justify-center text-ora-success hover:bg-ora-success/10 transition-colors">
                    <Check className="h-4 w-4 stroke-1" />
                  </button>
                  <button onClick={() => setEditId(null)} className="flex h-8 w-8 items-center justify-center text-ora-muted hover:bg-ora-cream-dark transition-colors">
                    <X className="h-4 w-4 stroke-1" />
                  </button>
                </div>
              ) : (
                <>
                  <span className="flex-1 text-sm text-ora-charcoal">{tag.name}</span>
                  <span className="text-xs text-ora-muted font-mono">/{tag.slug}</span>
                  <button onClick={() => { setEditId(tag.id); setEditName(tag.name); }} className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-dark transition-colors">
                    <Pencil className="h-3.5 w-3.5 stroke-1" />
                  </button>
                  <button onClick={() => handleDelete(tag.id)} disabled={deleteTag.isPending} className="flex h-8 w-8 items-center justify-center text-ora-error hover:bg-ora-error/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5 stroke-1" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
