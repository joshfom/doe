import Link from 'next/link';
import { ShieldOff } from 'lucide-react';

/**
 * 403 Forbidden page for the admin panel.
 *
 * Usage: import and render this component when a user lacks the required
 * permission for a page or action.
 *
 * Example:
 *   import Forbidden from '../forbidden';
 *   if (!hasAccess) return <Forbidden />;
 */
export default function Forbidden() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
        <ShieldOff className="h-8 w-8 text-amber-600 stroke-[1.5]" />
      </div>
      <h1 className="text-2xl font-semibold text-ora-charcoal">Access denied</h1>
      <p className="mt-2 max-w-sm text-sm text-ora-muted">
        You don't have permission to view this page. Contact your administrator if you believe this is an error.
      </p>
      <Link
        href="/ora-panel"
        className="mt-6 inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
