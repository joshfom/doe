'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

export default function OraError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[ora-panel] Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
        <AlertTriangle className="h-8 w-8 text-ora-error stroke-[1.5]" />
      </div>
      <h1 className="text-2xl font-semibold text-ora-charcoal">Something went wrong</h1>
      <p className="mt-2 max-w-sm text-sm text-ora-muted">
        An unexpected error occurred. Please try again or contact support if the problem persists.
      </p>
      {error.digest && (
        <p className="mt-2 text-xs text-ora-muted">
          Error ID: <code className="font-mono">{error.digest}</code>
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
        >
          Try again
        </button>
        <a
          href="/ora-panel"
          className="inline-flex h-10 items-center gap-2 border border-ora-sand px-6 text-sm text-ora-charcoal hover:bg-ora-sand/30 transition-colors"
        >
          Back to Feed
        </a>
      </div>
    </div>
  );
}
