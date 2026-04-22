import Link from "next/link";
import { pageManager } from "@/lib/page-builder/store";

export const dynamic = "force-dynamic";

export default async function BuilderPage() {
  const pages = await pageManager.listPages();

  return (
    <div className="min-h-screen bg-ora-cream-light p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-ora-muted">ORA</p>
            <h1 className="text-2xl font-semibold text-ora-charcoal">Pages</h1>
          </div>
          <Link
            href="/builder/new"
            className="bg-ora-gold px-4 py-2 text-sm font-medium text-white hover:bg-ora-gold-dark"
          >
            + New Page
          </Link>
        </div>

        {pages.length === 0 ? (
          <div className="border border-dashed border-ora-sand-dark p-12 text-center">
            <p className="text-ora-slate">No pages yet. Create your first page to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pages.map((page) => (
              <div
                key={page.id}
                className="flex items-center justify-between border border-ora-sand/60 bg-white p-4"
              >
                <div>
                  <Link
                    href={`/builder/editor/${page.id}`}
                    className="text-lg font-medium text-ora-charcoal hover:text-ora-gold"
                  >
                    {page.title}
                  </Link>
                  <p className="text-sm text-ora-slate">
                    /{page.slug} &middot;{" "}
                    <span
                      className={
                        page.status === "published"
                          ? "text-ora-success"
                          : "text-ora-warning"
                      }
                    >
                      {page.status}
                    </span>{" "}
                    &middot; Updated {new Date(page.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/builder/editor/${page.id}`}
                    className="bg-ora-cream px-3 py-1.5 text-sm text-ora-charcoal hover:bg-ora-cream-dark"
                  >
                    Edit
                  </Link>
                  {page.status === "published" && (
                    <Link
                      href={`/${page.slug}`}
                      className="bg-ora-success/10 px-3 py-1.5 text-sm text-ora-success hover:bg-ora-success/20"
                      target="_blank"
                    >
                      View
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
