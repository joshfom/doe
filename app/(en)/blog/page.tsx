import Link from "next/link";
import type { Metadata } from "next";
import { fetchPublicPosts } from "@/lib/cms/utils/fetch-post";
import { generateBlogMetadata } from "@/lib/cms/utils/blog-seo";

interface Props {
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return generateBlogMetadata({
    metaTitle: "News",
    metaDescription: "Latest news and press releases",
    slug: "blog",
    locale: "en",
    postType: "news",
  });
}

export default async function EnBlogListingPage({ searchParams }: Props) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
  const pageSize = 12;

  const { posts, total } = await fetchPublicPosts("en", page, pageSize, "news");
  const totalPages = Math.ceil(total / pageSize);

  // Separate featured posts from the rest
  const featuredPosts = posts.filter((p) => (p as any).featured);
  const regularPosts = posts.filter((p) => !(p as any).featured);

  // If no explicit featured posts, use the first post as featured
  const heroPost = featuredPosts.length > 0 ? featuredPosts[0] : posts[0];
  const gridPosts =
    featuredPosts.length > 0
      ? [...featuredPosts.slice(1), ...regularPosts]
      : posts.slice(1);

  return (
    <main className="bg-ora-white">
      {/* Featured / Hero News */}
      {heroPost && (
        <section className="mx-auto max-w-7xl px-6 pt-24 md:px-10 lg:px-16">
          <Link
            href={`/blog/${heroPost.slug}`}
            className="group block"
          >
            {heroPost.featuredImage && (
              <div className="relative aspect-[21/9] overflow-hidden bg-ora-sand/30">
                <img
                  src={heroPost.featuredImage}
                  alt={heroPost.title}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                {heroPost.categories && heroPost.categories.length > 0 && (
                  <span className="absolute bottom-4 left-4 bg-ora-teal px-3 py-1 text-[10px] uppercase tracking-wider text-ora-white font-medium">
                    {heroPost.categories[0].name}
                  </span>
                )}
              </div>
            )}
            <div className="mt-5 flex items-start justify-between gap-4">
              <div>
                {heroPost.publishedAt && (
                  <time
                    dateTime={new Date(heroPost.publishedAt).toISOString()}
                    className="text-sm text-ora-charcoal-light"
                  >
                    {new Date(heroPost.publishedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </time>
                )}
                <h2 className="mt-2 font-serif text-2xl text-ora-charcoal md:text-3xl">
                  {heroPost.title}
                </h2>
              </div>
              <span className="mt-2 flex h-8 shrink-0 items-center justify-center rounded-full border border-ora-charcoal/30 px-4 text-ora-charcoal transition-colors group-hover:border-ora-charcoal group-hover:bg-ora-charcoal group-hover:text-ora-white">
                <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
                  <path d="M1 6h16M12 1l5 5-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </Link>
        </section>
      )}

      {/* News Grid */}
      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10 lg:px-16">
        {gridPosts.length === 0 && !heroPost ? (
          <p className="text-sm text-ora-muted">No news published yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {gridPosts.map((post) => (
              <Link
                key={post.id}
                href={`/blog/${post.slug}`}
                className="group block"
              >
                {/* Image */}
                <div className="relative aspect-4/3 overflow-hidden bg-ora-sand/30">
                  {post.featuredImage && (
                    <img
                      src={post.featuredImage}
                      alt={post.title}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                  {post.categories && post.categories.length > 0 && (
                    <span className="absolute bottom-3 left-3 bg-ora-teal px-3 py-1 text-[10px] uppercase tracking-wider text-ora-white font-medium">
                      {post.categories[0].name}
                    </span>
                  )}
                </div>
                {/* Info */}
                <div className="mt-4">
                  {post.publishedAt && (
                    <time
                      dateTime={new Date(post.publishedAt).toISOString()}
                      className="text-xs text-ora-charcoal-light"
                    >
                      {new Date(post.publishedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </time>
                  )}
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <h3 className="text-base font-medium leading-snug text-ora-charcoal">
                      {post.title}
                    </h3>
                    <span className="mt-0.5 flex h-7 shrink-0 items-center justify-center rounded-full border border-ora-charcoal/30 px-3 text-ora-charcoal transition-colors group-hover:border-ora-charcoal group-hover:bg-ora-charcoal group-hover:text-ora-white">
                      <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
                        <path d="M1 5h12M9 1l4 4-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <nav className="mt-16 flex items-center justify-center gap-2" aria-label="Pagination">
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
      </section>
    </main>
  );
}
