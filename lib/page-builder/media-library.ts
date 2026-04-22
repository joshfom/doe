/**
 * In-memory media library for the page builder.
 * Stores image metadata and provides search/upload capabilities.
 * In production, swap this with an S3/Cloudflare R2/database-backed implementation.
 */

export interface MediaItem {
  id: string;
  src: string;
  alt: string;
  name: string;
  width?: number;
  height?: number;
  createdAt: string;
}

export interface MediaLibrary {
  list(query?: string): MediaItem[];
  getById(id: string): MediaItem | null;
  add(item: Omit<MediaItem, "id" | "createdAt">): MediaItem;
  delete(id: string): void;
}

/**
 * Creates an in-memory media library pre-seeded with sample images.
 */
export function createMediaLibrary(): MediaLibrary {
  const items: MediaItem[] = [
    {
      id: "stock-1",
      src: "https://placehold.co/800x400/2563eb/ffffff?text=Hero+Image",
      alt: "Hero banner image",
      name: "Hero Banner",
      width: 800,
      height: 400,
      createdAt: new Date().toISOString(),
    },
    {
      id: "stock-2",
      src: "https://placehold.co/600x400/10b981/ffffff?text=Feature+Image",
      alt: "Feature image",
      name: "Feature Image",
      width: 600,
      height: 400,
      createdAt: new Date().toISOString(),
    },
    {
      id: "stock-3",
      src: "https://placehold.co/800x600/f59e0b/ffffff?text=About+Us",
      alt: "About us image",
      name: "About Us",
      width: 800,
      height: 600,
      createdAt: new Date().toISOString(),
    },
    {
      id: "stock-4",
      src: "https://placehold.co/400x400/8b5cf6/ffffff?text=Team",
      alt: "Team photo",
      name: "Team Photo",
      width: 400,
      height: 400,
      createdAt: new Date().toISOString(),
    },
    {
      id: "stock-5",
      src: "https://placehold.co/1200x400/ec4899/ffffff?text=Banner",
      alt: "Wide banner",
      name: "Wide Banner",
      width: 1200,
      height: 400,
      createdAt: new Date().toISOString(),
    },
  ];

  return {
    list(query?: string): MediaItem[] {
      if (!query || !query.trim()) return [...items];
      const q = query.toLowerCase();
      return items.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          item.alt.toLowerCase().includes(q)
      );
    },

    getById(id: string): MediaItem | null {
      return items.find((item) => item.id === id) ?? null;
    },

    add(input: Omit<MediaItem, "id" | "createdAt">): MediaItem {
      const item: MediaItem = {
        ...input,
        id: `upload-${crypto.randomUUID()}`,
        createdAt: new Date().toISOString(),
      };
      items.unshift(item);
      return item;
    },

    delete(id: string): void {
      const idx = items.findIndex((item) => item.id === id);
      if (idx !== -1) items.splice(idx, 1);
    },
  };
}
