import Link from "next/link";
import type { Metadata } from "next";
import { fetchPublicPosts } from "@/lib/cms/utils/fetch-post";
import { generateBlogMetadata } from "@/lib/cms/utils/blog-seo";

interface Props {
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return generateBlogMetadata({
    metaTitle: "Blog",
    metaDescription: "Latest blog posts and articles",
    slug: "blog",
    locale: "en",
    postType: "blog",
  });
}

export default async function EnBlogListingPage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const pageSize = 12;

  const { posts, total } = await fetchPublicPosts("en", page, pageSize);
  const totalPages = Math.ceil(total / pageSize);

  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Blog</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          Latest posts and articles
        </p>
      </div>

      {posts.length === 0 ? (
        <p className="text-sm text-ora-muted">No posts found.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/blog/${post.slug}`}
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
                    {new Date(post.publishedAt).toLocaleDateString("en-US", {
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
        <nav className="mt-10 flex items-center justify-center gap-2" aria-label="Pagination">
          {page > 1 && (
            <Link
              href={`/blog?page=${page - 1}`}
              className="border border-ora-sand px-4 py-2 text-sm text-ora-charcoal hover:bg-ora-cream-light transition-colors"
            >
              Previous
            </Link>
          )}
          <span className="px-3 py-2 text-sm text-ora-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/blog?page=${page + 1}`}
              className="border border-ora-sand px-4 py-2 text-sm text-ora-charcoal hover:bg-ora-cream-light transition-colors"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
