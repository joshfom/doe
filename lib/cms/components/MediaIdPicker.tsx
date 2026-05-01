'use client';

import { useState, useMemo } from 'react';
import { Image as ImageIcon, X, FileText } from 'lucide-react';
import { useMedia } from '@/lib/cms/hooks/use-media';
import { MediaPickerModal, type MediaItem } from './MediaPickerModal';

/**
 * MediaIdPicker — visual picker that stores a media item's ID (UUID).
 *
 * Renders a thumbnail preview of the selected media when present, and a
 * "Choose" button that opens the global MediaPickerModal. Looks up the
 * preview from the cached media list (`useMedia`) so previously-saved IDs
 * still render even though only the ID is stored.
 *
 * Use for project assets: heroImageId, logoImageId, brochurePdfId, and
 * media-id slots inside floorplans/amenities/gallery rows.
 */
export function MediaIdPicker({
  value,
  onChange,
  mimeTypeFilter,
  label,
  hint,
  size = 'md',
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  /** e.g. "image/" or "application/pdf" */
  mimeTypeFilter?: string;
  label?: string;
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [open, setOpen] = useState(false);

  // Cached lookup: pull the entire (filtered) list once and find by id.
  const { data: items } = useMedia(undefined, mimeTypeFilter);
  const selected = useMemo(
    () => items?.find((m) => m.id === value) ?? null,
    [items, value]
  );

  const isPdf = selected?.mimeType === 'application/pdf';
  const dim =
    size === 'sm' ? 'h-16 w-16' : size === 'lg' ? 'h-40 w-40' : 'h-24 w-24';

  return (
    <div>
      {label && (
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ora-muted">
          {label}
          {hint && (
            <span className="ml-2 normal-case text-[10px] text-ora-muted">
              {hint}
            </span>
          )}
        </p>
      )}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`relative flex ${dim} shrink-0 items-center justify-center overflow-hidden border border-ora-sand bg-ora-cream-light transition-colors hover:border-ora-gold focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:outline-none`}
          title={selected?.filename ?? 'Choose media'}
        >
          {selected ? (
            isPdf ? (
              <div className="flex flex-col items-center gap-1 px-2 text-center">
                <FileText className="h-6 w-6 stroke-1 text-ora-gold-dark" />
                <span className="truncate text-[9px] text-ora-muted">
                  {selected.filename}
                </span>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.storageUrl}
                alt={selected.altText ?? selected.filename}
                className="h-full w-full object-cover"
              />
            )
          ) : value ? (
            <span className="px-1 text-center font-mono text-[9px] text-ora-muted">
              {value.slice(0, 8)}…
            </span>
          ) : (
            <ImageIcon className="h-6 w-6 stroke-1 text-ora-muted" />
          )}
        </button>

        <div className="flex flex-col gap-1 text-xs text-ora-charcoal-light">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 items-center border border-ora-sand bg-ora-white px-3 text-xs hover:bg-ora-cream"
          >
            {value ? 'Replace' : 'Choose'}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex h-8 items-center gap-1 border border-ora-sand bg-ora-white px-3 text-xs text-ora-error hover:bg-ora-error/10"
            >
              <X className="h-3 w-3 stroke-1" />
              Remove
            </button>
          )}
          {selected && (
            <span className="max-w-40 truncate text-[10px] text-ora-muted">
              {selected.filename}
            </span>
          )}
        </div>
      </div>

      <MediaPickerModal
        open={open}
        onClose={() => setOpen(false)}
        onSelectItem={(item: MediaItem) => onChange(item.id)}
        mimeTypeFilter={mimeTypeFilter}
      />
    </div>
  );
}

/**
 * MediaIdGallery — ordered list of media IDs with thumbnails, add/remove,
 * and reorder controls. Stored as `string[]`.
 */
export function MediaIdGallery({
  value,
  onChange,
  mimeTypeFilter = 'image/',
  label,
  hint,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  mimeTypeFilter?: string;
  label?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: items } = useMedia(undefined, mimeTypeFilter);
  const lookup = useMemo(() => {
    const m = new Map<string, MediaItem>();
    items?.forEach((i) => m.set(i.id, i));
    return m;
  }, [items]);

  function add(id: string) {
    if (value.includes(id)) return;
    onChange([...value, id]);
  }
  function remove(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    const next = [...value];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div>
      {label && (
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-ora-muted">
            {label}
            {hint && (
              <span className="ml-2 normal-case text-[10px] text-ora-muted">
                {hint}
              </span>
            )}
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 items-center border border-ora-sand bg-ora-white px-3 text-xs hover:bg-ora-cream"
          >
            + Add image
          </button>
        </div>
      )}

      {value.length === 0 ? (
        <div className="border border-dashed border-ora-sand bg-ora-cream/30 p-6 text-center text-xs text-ora-muted">
          No images yet. Click “Add image” to choose from the media library.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {value.map((id, idx) => {
            const item = lookup.get(id);
            return (
              <div
                key={`${id}-${idx}`}
                className="group relative aspect-square overflow-hidden border border-ora-sand bg-ora-cream-light"
              >
                {item ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.storageUrl}
                    alt={item.altText ?? item.filename}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-mono text-[9px] text-ora-muted">
                    {id.slice(0, 8)}…
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ora-charcoal/70 px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="px-1 text-[10px] text-ora-white disabled:opacity-30"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    className="px-1 text-[10px] text-ora-error"
                  >
                    ✕
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === value.length - 1}
                    className="px-1 text-[10px] text-ora-white disabled:opacity-30"
                  >
                    →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <MediaPickerModal
        open={open}
        onClose={() => setOpen(false)}
        onSelectItem={(item) => add(item.id)}
        mimeTypeFilter={mimeTypeFilter}
      />
    </div>
  );
}
