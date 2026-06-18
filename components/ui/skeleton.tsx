import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Skeleton — a single shimmering placeholder block.
 *
 * shadcn-style primitive adapted to the Ora design tokens. Use it to build
 * layout-matching loading states so the placeholder mirrors the shape of the
 * real data (text lines, avatars, cards, table rows) instead of a spinner.
 */
export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-ora-sand/60', className)}
      {...props}
    />
  );
}
