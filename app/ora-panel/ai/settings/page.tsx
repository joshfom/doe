'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * AI Settings has been consolidated into the unified Settings page.
 * This page redirects to /ora-panel/settings?tab=ai for backwards compatibility.
 */
export default function AISettingsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/ora-panel/settings?tab=ai');
  }, [router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <p className="text-sm text-ora-muted">Redirecting to Settings…</p>
    </div>
  );
}
