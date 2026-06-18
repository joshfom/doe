import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ── Panel skeletons ──────────────────────────────────────────────────────────
// Composable, layout-matching loading placeholders for the Ora panel. Each one
// mirrors the shape of the real content (header, stat cards, lists, tables,
// detail forms) so the page doesn't jump when data arrives — and so we never
// fall back to a bare spinner.

/** Title + subtitle block that matches the standard panel page header. */
export function PageHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('mb-6 space-y-2', className)}>
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-72" />
    </div>
  );
}

/** Grid of metric/stat cards. */
export function StatCardsSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4',
        className
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="border border-ora-sand/60 bg-ora-white p-5 space-y-3"
        >
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Stacked list rows (cards). */
export function ListSkeleton({
  rows = 4,
  rowClassName,
  className,
}: {
  rows?: number;
  rowClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-16 w-full rounded', rowClassName)}
        />
      ))}
    </div>
  );
}

/** Table with header + body rows, matching column widths. */
export function TableSkeleton({
  columns = 5,
  rows = 6,
  className,
}: {
  columns?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('border border-ora-sand/60 bg-ora-white', className)}
    >
      {/* Header */}
      <div className="flex gap-4 border-b border-ora-sand/60 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Body */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="flex gap-4 border-b border-ora-sand/40 px-4 py-3.5 last:border-0"
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1 bg-ora-sand/40" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Detail / edit form: a couple of card sections with labelled fields. */
export function DetailFormSkeleton({
  sections = 1,
  fieldsPerSection = 4,
  className,
}: {
  sections?: number;
  fieldsPerSection?: number;
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl space-y-6', className)}>
      {Array.from({ length: sections }).map((_, s) => (
        <div
          key={s}
          className="border border-ora-sand/60 bg-ora-white p-6 space-y-5"
        >
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-2 gap-4">
            {Array.from({ length: fieldsPerSection }).map((_, f) => (
              <div key={f} className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Full standard panel page placeholder: header + a body region. Defaults to a
 * list body but accepts any children to compose a tailored shape.
 */
export function PanelPageSkeleton({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <PageHeaderSkeleton />
      {children ?? <ListSkeleton />}
    </div>
  );
}

/**
 * Detail / edit page placeholder: breadcrumb + header row + a form-shaped body.
 * Used by the `[id]` edit pages so the loading state mirrors the editor layout.
 */
export function DetailPageSkeleton({
  fieldsPerSection = 6,
  className,
}: {
  fieldsPerSection?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-3" />
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-3" />
        <Skeleton className="h-3 w-20" />
      </div>
      {/* Header row */}
      <div className="mb-6 flex items-start justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
      <DetailFormSkeleton fieldsPerSection={fieldsPerSection} />
    </div>
  );
}
