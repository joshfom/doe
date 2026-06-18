'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  useBlogCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from '@/lib/cms/hooks';
import type { CategoryTree } from '@/lib/cms/types';
import { ChevronRight, Plus, Pencil, Trash2, X, Check } from 'lucide-react';

export default function CategoriesPage() {
  const { data: categories, isLoading } = useBlogCategories();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const deleteCategory = useDeleteCategory();

  const [newName, setNewName] = useState('');
  const [newParentId, setNewParentId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editParentId, setEditParentId] = useState<string | null>(null);

  // Flatten categories for parent selector
  const flatCategories: { id: string; name: string; depth: number }[] = [];
  const flatten = (nodes: CategoryTree[], depth = 0) => {
    for (const n of nodes) {
      flatCategories.push({ id: n.id, name: n.name, depth });
      if (n.children?.length) flatten(n.children, depth + 1);
    }
  };
  if (categories) flatten(categories);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createCategory.mutateAsync({ name: newName.trim(), parentId: newParentId });
    setNewName('');
    setNewParentId(null);
    setShowCreate(false);
  };

  const handleUpdate = async () => {
    if (!editId || !editName.trim()) return;
    await updateCategory.mutateAsync({ id: editId, name: editName.trim(), parentId: editParentId });
    setEditId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteCategory.mutateAsync(id);
  };

  const startEdit = (cat: CategoryTree) => {
    setEditId(cat.id);
    setEditName(cat.name);
    setEditParentId(cat.parentId);
  };

  const renderTree = (nodes: CategoryTree[], depth = 0) =>
    nodes.map((cat) => (
      <div key={cat.id}>
        <div
          className="flex items-center gap-3 border-b border-ora-sand/40 py-3 hover:bg-ora-cream-light transition-colors"
          style={{ paddingLeft: `${depth * 24 + 16}px`, paddingRight: '16px' }}
        >
          {editId === cat.id ? (
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 flex-1 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(); if (e.key === 'Escape') setEditId(null); }}
              />
              <select
                value={editParentId ?? ''}
                onChange={(e) => setEditParentId(e.target.value || null)}
                className="h-8 border border-ora-stone bg-ora-white px-2 text-xs text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              >
                <option value="">No parent (root)</option>
                {flatCategories.filter((c) => c.id !== cat.id).map((c) => (
                  <option key={c.id} value={c.id}>{'—'.repeat(c.depth)} {c.name}</option>
                ))}
              </select>
              <button onClick={handleUpdate} disabled={updateCategory.isPending} className="flex h-8 w-8 items-center justify-center text-ora-success hover:bg-ora-success/10 transition-colors">
                <Check className="h-4 w-4 stroke-1" />
              </button>
              <button onClick={() => setEditId(null)} className="flex h-8 w-8 items-center justify-center text-ora-muted hover:bg-ora-cream-dark transition-colors">
                <X className="h-4 w-4 stroke-1" />
              </button>
            </div>
          ) : (
            <>
              <span className="flex-1 text-sm text-ora-charcoal">{cat.name}</span>
              <span className="text-xs text-ora-muted font-mono">/{cat.slug}</span>
              <button onClick={() => startEdit(cat)} className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:bg-ora-cream-dark transition-colors">
                <Pencil className="h-3.5 w-3.5 stroke-1" />
              </button>
              <button onClick={() => handleDelete(cat.id)} disabled={deleteCategory.isPending} className="flex h-8 w-8 items-center justify-center text-ora-error hover:bg-ora-error/10 transition-colors">
                <Trash2 className="h-3.5 w-3.5 stroke-1" />
              </button>
            </>
          )}
        </div>
        {cat.children?.length > 0 && renderTree(cat.children, depth + 1)}
      </div>
    ));

  return (
    <div>
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Feed</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/blog" className="hover:text-ora-charcoal transition-colors">Blog</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">Categories</span>
      </nav>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Categories</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Manage blog categories</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors">
          <Plus className="h-4 w-4 stroke-1" /> New Category
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-4 flex items-center gap-3 border border-ora-sand/60 bg-ora-white p-4">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Category name"
            className="h-10 flex-1 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <select
            value={newParentId ?? ''}
            onChange={(e) => setNewParentId(e.target.value || null)}
            className="h-10 border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          >
            <option value="">No parent (root)</option>
            {flatCategories.map((c) => (
              <option key={c.id} value={c.id}>{'—'.repeat(c.depth)} {c.name}</option>
            ))}
          </select>
          <button onClick={handleCreate} disabled={createCategory.isPending || !newName.trim()} className="h-10 bg-ora-gold px-6 text-sm text-ora-white hover:bg-ora-gold-dark transition-colors disabled:opacity-50">
            {createCategory.isPending ? 'Creating…' : 'Create'}
          </button>
          <button onClick={() => { setShowCreate(false); setNewName(''); setNewParentId(null); }} className="h-10 border border-ora-sand bg-ora-cream px-4 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">
            Cancel
          </button>
        </div>
      )}

      {/* Tree */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse bg-ora-sand/60" />)}</div>
      ) : !categories?.length ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center"><p className="text-sm text-ora-muted">No categories yet</p></div>
      ) : (
        <div className="border border-ora-sand/60 bg-ora-white">{renderTree(categories)}</div>
      )}
    </div>
  );
}
