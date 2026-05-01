import Link from "next/link";
import type { Metadata } from "next";
import { fetchPublicPosts } from "@/lib/cms/utils/fetch-post";
import { generateBlogMetadata } from "@/lib/cms/utils/blog-seo";

interface Props {
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return generateBlogMetadata({
    metaTitle: "المدونة",
    metaDescription: "أحدث المقالات والأخبار",
    slug: "blog",
    locale: "ar",
    postType: "blog",
  });
}

export default async function ArBlogListingPage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const pageSize = 12;

  const { posts, total } = await fetchPublicPosts("ar", page, pageSize);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-ora-charcoal">المدونة</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          أحدث المقالات والأخبار
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-ora-muted">لا توجد مقالات.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/ar/blog/${post.slug}`}
              className="group border border-ora-sand/60 bg-ora-white transition-colors hover:border-ora-sand"
            >
              {post.featuredImage && (
                <div className="aspect-video overflow-hidden">
                  <img
                    src={post.featuredImage}
                    alt={post.title}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                  />
                </div>
              )}
              <div className="p-5">
                {post.categories && post.categories.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {post.categories.map((cat) => (
                      <span
                        key={cat.id}
                        className="inline-block rounded-full bg-ora-gold/10 px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase text-ora-gold-dark"
                      >
                        {cat.name}
                      </span>
                    ))}
                  </div>
                )}
                <h2 className="text-lg font-semibold text-ora-charcoal group-hover:text-ora-gold-dark transition-colors">
                  {post.title}
                </h2>
                {post.excerpt && (
                  <p className="mt-2 text-sm text-ora-charcoal-light line-clamp-2">
                    {post.excerpt}
                  </p>
                )}
                {post.publishedAt && (
                  <time
                    dateTime={new Date(post.publishedAt).toISOString()}
                    className="mt-3 block text-xs text-ora-muted"
                  >
                    {new Date(post.publishedAt).toLocaleDateString("ar-SA", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label="التنقل بين الصفحات">
          {page > 1 && (
            <Link
              href={`/ar/blog?page=${page - 1}`}
              className="border border-ora-sand px-4 py-2 text-sm text-ora-charcoal hover:bg-ora-cream-light transition-colors"
            >
              السابق
            </Link>
          )}
          <span className="px-3 py-2 text-sm text-ora-muted">
            صفحة {page} من {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/ar/blog?page=${page + 1}`}
              className="border border-ora-sand px-4 py-2 text-sm text-ora-charcoal hover:bg-ora-cream-light transition-colors"
            >
              التالي
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
