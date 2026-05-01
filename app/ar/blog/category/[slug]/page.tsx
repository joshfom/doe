import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchPostsByCategory } from "@/lib/cms/utils/fetch-post";
import { generateBlogMetadata } from "@/lib/cms/utils/blog-seo";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { category } = await fetchPostsByCategory("ar", slug, 1);

  if (!category) {
    return { title: "التصنيف غير موجود" };
  }

  return generateBlogMetadata({
    metaTitle: `${category.name} — المدونة`,
    metaDescription: `مقالات في تصنيف ${category.name}`,
    slug: `blog/category/${slug}`,
    locale: "ar",
    postType: "blog",
  });
}

export default async function ArCategoryArchivePage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const pageSize = 12;

  const { posts, total, category } = await fetchPostsByCategory("ar", slug, page, pageSize);

  if (!category) {
    notFound();
  }

  const totalPages = Math.ceil(total / pageSize);

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <div className="mb-10">
        <p className="text-xs font-medium uppercase tracking-widest text-ora-muted mb-1">التصنيف</p>
        <h1 className="text-2xl font-semibold text-ora-charcoal">{category.name}</h1>
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-ora-muted">لا توجد مقالات في هذا التصنيف.</p>
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

      {totalPages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label="التنقل بين الصفحات">
          {page > 1 && (
            <Link
              href={`/ar/blog/category/${slug}?page=${page - 1}`}
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
              href={`/ar/blog/category/${slug}?page=${page + 1}`}
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
