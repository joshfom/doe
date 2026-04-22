'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '@/lib/cms/hooks/api';
import { Search, X, Upload, Image as ImageIcon } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface MediaItem {
  id: string;
  filename: string;
  altText: string | null;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  storageUrl: string;
  storageBackend: string;
  createdAt: string;
}

interface MediaPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (storageUrl: string) => void;
  mimeTypeFilter?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function MediaPickerModal({
  open,
  onClose,
  onSelect,
  mimeTypeFilter,
}: MediaPickerModalProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch media items
  const fetchMedia = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (mimeTypeFilter) params.set('mimeType', mimeTypeFilter);
      const qs = params.toString();
      const res = await apiFetch<{ data: MediaItem[] }>(
        `/api/media${qs ? `?${qs}` : ''}`
      );
      setItems(res.data);
    } catch {
      setError('Failed to load media');
    } finally {
      setLoading(false);
    }
  }, [search, mimeTypeFilter]);

  // Load on open and when search changes
  useEffect(() => {
    if (!open) return;
    fetchMedia();
  }, [open, fetchMedia]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Upload handler
  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        await apiFetch<{ data: MediaItem }>('/api/media', {
          method: 'POST',
          body: formData,
        });
        // Refresh the list
        await fetchMedia();
      } catch {
        setError('Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [fetchMedia]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleUpload(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [handleUpload]
  );

  const handleSelect = useCallback(
    (url: string) => {
      onSelect(url);
      onClose();
    },
    [onSelect, onClose]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      {/* Glassmorphic backdrop */}
      <div
        className="absolute inset-0 bg-ora-charcoal/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative z-10 flex h-[85vh] w-[90vw] max-w-5xl flex-col bg-ora-white border border-ora-sand shadow-ora-lg">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ora-sand px-6 py-4">
          <h2 className="text-lg font-semibold text-ora-charcoal">Media Library</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex h-9 items-center gap-2 bg-ora-gold px-5 text-sm font-medium text-white hover:bg-ora-gold-dark transition-colors disabled:opacity-50"
            >
              <Upload className="h-4 w-4 stroke-1" />
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center text-ora-charcoal-light hover:text-ora-charcoal transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5 stroke-1" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="border-b border-ora-sand px-6 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-1 text-ora-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search media…"
              className="h-10 w-full border border-ora-stone bg-ora-white pl-10 pr-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-square animate-pulse bg-ora-sand/60"
                />
              ))}
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-sm text-ora-error">{error}</p>
              <button
                type="button"
                onClick={fetchMedia}
                className="mt-3 text-sm text-ora-gold hover:text-ora-gold-dark transition-colors"
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ImageIcon className="h-10 w-10 stroke-1 text-ora-muted" />
              <p className="mt-3 text-sm text-ora-charcoal-light">
                {search ? 'No media found matching your search.' : 'No media items yet. Upload one to get started.'}
              </p>
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-5">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item.storageUrl)}
                  className="group relative aspect-square overflow-hidden border border-ora-sand bg-ora-cream-light transition-colors hover:border-ora-gold focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2 focus-visible:outline-none"
                >
                  {item.mimeType.startsWith('image/') ? (
                    <img
                      src={item.storageUrl}
                      alt={item.altText || item.filename}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <ImageIcon className="h-8 w-8 stroke-1 text-ora-muted" />
                    </div>
                  )}
                  {/* Hover overlay with filename */}
                  <div className="absolute inset-x-0 bottom-0 bg-ora-charcoal/70 px-2 py-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="truncate text-[10px] text-ora-white">
                      {item.filename}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
