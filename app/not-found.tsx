import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-[10px] tracking-widest uppercase font-bold text-ora-muted mb-4">
        Error 404
      </p>
      <h1 className="text-2xl font-semibold text-ora-charcoal mb-2">
        Page not found
      </h1>
      <p className="text-sm text-ora-charcoal-light mb-8 max-w-md">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="inline-flex h-10 items-center px-6 text-sm font-medium bg-ora-charcoal text-ora-white hover:bg-ora-graphite transition-colors"
      >
        Back to home
      </Link>
    </div>
  );
}
