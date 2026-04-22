"use client";

import { useState } from "react";
import { useMedia } from "@/lib/cms/hooks";
import { Search, Image as ImageIcon } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface MediaPickerProps {
  onSelect: (storageUrl: string) => void;
  mimeTypeFilter?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function MediaPicker({ onSelect, mimeTypeFilter }: MediaPickerProps) {
  const [search, setSearch] = useState("");
  const { data: items, isLoading, error } = useMedia(search || undefined, mimeTypeFilter);

  return (
    <div className="flex flex-col gap-4">
      {/* Search input */}
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

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded bg-ora-sand/60"
            />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <p className="text-sm text-ora-error">
          Failed to load media. Please try again.
        </p>
      )}

      {/* Empty state */}
      {!isLoading && !error && items?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ImageIcon className="h-10 w-10 stroke-1 text-ora-muted" />
          <p className="mt-3 text-sm text-ora-charcoal-light">
            {search ? "No media found matching your search." : "No media items yet."}
          </p>
        </div>
      )}

      {/* Media grid */}
      {!isLoading && items && items.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.storageUrl)}
              className="group relative aspect-square overflow-hidden border border-ora-sand bg-ora-cream-light transition-colors hover:border-ora-gold focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {item.mimeType.startsWith("image/") ? (
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
              <div className="absolute inset-x-0 bottom-0 bg-ora-charcoal/70 px-2 py-1 opacity-0 transition-opacity group-hover:opacity-100">
                <p className="truncate text-[10px] text-ora-white">
                  {item.filename}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
