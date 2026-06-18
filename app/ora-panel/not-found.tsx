import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

export default function OraNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-ora-sand/60">
        <FileQuestion className="h-8 w-8 text-ora-charcoal-light stroke-[1.5]" />
      </div>
      <h1 className="text-2xl font-semibold text-ora-charcoal">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-ora-muted">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link
        href="/ora-panel"
        className="mt-6 inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
      >
        Back to Feed
      </Link>
    </div>
  );
}
