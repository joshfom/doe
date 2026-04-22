'use client';

import { useRef, useState } from 'react';
import {
  useMedia,
  useUploadMedia,
  useDeleteMedia,
  useUpdateMediaAlt,
} from '@/lib/cms/hooks';
import { Upload, Trash2, Search } from 'lucide-react';

export default function MediaLibraryPage() {
  const [search, setSearch] = useState('');
  const [mimeFilter, setMimeFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: items, isLoading } = useMedia(search || undefined, mimeFilter || undefined);
  const uploadMedia = useUploadMedia();
  const deleteMedia = useDeleteMedia();
  const updateAlt = useUpdateMediaAlt();

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [editingAlt, setEditingAlt] = useState<{ id: string; value: string } | null>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadMedia.mutate({ file });
      e.target.value = '';
    }
  };

  const handleDelete = (id: string) => {
    deleteMedia.mutate(id, { onSettled: () => setDeleteTarget(null) });
  };

  const handleAltSave = () => {
    if (editingAlt) {
      updateAlt.mutate(
        { id: editingAlt.id, altText: editingAlt.value },
        { onSettled: () => setEditingAlt(null) }
      );
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Media Library</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Manage uploaded files</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMedia.isPending}
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
        >
          <Upload className="h-4 w-4 stroke-1" />
          {uploadMedia.isPending ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="hidden"
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-1 text-ora-muted" />
          <input
            type="text"
            placeholder="Search by filename or alt text…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full border border-ora-stone bg-ora-white pl-10 pr-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
        <select
          value={mimeFilter}
          onChange={(e) => setMimeFilter(e.target.value)}
          className="h-10 border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
        >
          <option value="">All types</option>
          <option value="image/jpeg">JPEG</option>
          <option value="image/png">PNG</option>
          <option value="image/webp">WebP</option>
          <option value="image/svg+xml">SVG</option>
        </select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="aspect-square animate-pulse bg-ora-sand/60" />
          ))}
        </div>
      ) : !items?.length ? (
        <div className="border border-ora-sand/60 bg-ora-white p-12 text-center">
          <p className="text-sm text-ora-muted">No media items found</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div key={item.id} className="border border-ora-sand/60 bg-ora-white">
              {/* Thumbnail */}
              <div className="relative aspect-video bg-ora-cream-light">
                <img
                  src={item.storageUrl}
                  alt={item.altText ?? item.filename}
                  className="h-full w-full object-cover"
                />
              </div>

              {/* Info */}
              <div className="p-4">
                <p className="truncate text-sm font-medium text-ora-charcoal">{item.filename}</p>
                <p className="text-xs text-ora-muted">
                  {item.mimeType} · {(item.fileSize / 1024).toFixed(0)} KB
                  {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
                </p>

                {/* Alt text editing */}
                {editingAlt?.id === item.id ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={editingAlt.value}
                      onChange={(e) => setEditingAlt({ ...editingAlt, value: e.target.value })}
                      className="h-8 flex-1 border border-ora-stone bg-ora-white px-2 text-xs text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                    />
                    <button
                      onClick={handleAltSave}
                      className="h-8 bg-ora-charcoal px-3 text-xs text-ora-white hover:bg-ora-graphite transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingAlt(null)}
                      className="h-8 border border-ora-sand px-3 text-xs text-ora-charcoal hover:bg-ora-cream transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setEditingAlt({ id: item.id, value: item.altText ?? '' })}
                    className="mt-2 text-xs text-ora-gold hover:text-ora-gold-dark transition-colors"
                  >
                    {item.altText ? `Alt: ${item.altText}` : 'Add alt text'}
                  </button>
                )}

                {/* Delete */}
                <div className="mt-3 flex justify-end">
                  {deleteTarget === item.id ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={deleteMedia.isPending}
                        className="h-8 bg-ora-error px-3 text-xs text-ora-white hover:opacity-90 transition-colors"
                      >
                        Confirm Delete
                      </button>
                      <button
                        onClick={() => setDeleteTarget(null)}
                        className="h-8 border border-ora-sand px-3 text-xs text-ora-charcoal hover:bg-ora-cream transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteTarget(item.id)}
                      className="inline-flex h-8 items-center gap-1 text-xs text-ora-muted hover:text-ora-error transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5 stroke-1" />
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
