import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchPublicPost, fetchRelatedPosts } from "@/lib/cms/utils/fetch-post";
import { generateBlogMetadata } from "@/lib/cms/utils/blog-seo";
import { generateStructuredData } from "@/lib/cms/utils/structured-data";
import { renderTiptapToHtml } from "@/lib/cms/utils/rich-text-renderer";
import { ShareButtons } from "@/lib/cms/components/ShareButtons";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await fetchPublicPost("en", slug);

  if (!post) {
    return { title: "Post Not Found" };
  }

  return generateBlogMetadata({
    metaTitle: post.metaTitle ?? post.title,
    metaDescription: post.metaDescription ?? post.excerpt,
    metaKeywords: post.metaKeywords,
    ogImage: post.ogImage,
    featuredImage: post.featuredImage,
    canonicalUrl: post.canonicalUrl,
    robotsDirective: post.robotsDirective,
    slug: post.slug,
    locale: "en",
    postType: post.postType as "blog" | "news",
  });
}

export default async function EnBlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await fetchPublicPost("en", slug);

  if (!post) {
    notFound();
  }

  // Fire-and-forget view tracking
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "";
  fetch(`${baseUrl}/api/stats/view/${post.id}`, { method: "POST" }).catch(() => {});

  const contentHtml = renderTiptapToHtml(post.content as Record<string, unknown>);
  const relatedPosts = await fetchRelatedPosts(post.id, "en", 3);
  const postUrl = `${baseUrl}/blog/${post.slug}`;

  const structuredData = generateStructuredData({
    postType: post.postType as "blog" | "news",
    title: post.metaTitle ?? post.title,
    description: post.metaDescription ?? post.excerpt ?? "",
    image: post.featuredImage ?? undefined,
    publishedAt: post.publishedAt ? new Date(post.publishedAt).toISOString() : new Date(post.createdAt).toISOString(),
    updatedAt: new Date(post.updatedAt).toISOString(),
    authorName: post.author?.name ?? "ORA",
    url: postUrl,
  });

  return (
    <main className="bg-ora-white">
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* Featured Image — full-width hero */}
      {post.featuredImage && (
        <div className="relative aspect-[21/9] w-full overflow-hidden bg-ora-sand/30">
          <img
            src={post.featuredImage}
            alt={post.title}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </div>
      )}

      {/* Back to News */}
      <div className="mx-auto max-w-4xl px-6 pt-10 md:px-10">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-sm text-ora-charcoal-light hover:text-ora-charcoal transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.2" />
            <path d="M11.5 7L8.5 10l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to News
        </Link>
      </div>

      <article className="mx-auto max-w-4xl px-6 py-10 md:px-10">
        {/* Category badge + date */}
        <div className="flex items-center gap-3">
          {post.categories && post.categories.length > 0 && (
            <Link
              href={`/blog/category/${post.categories[0].slug}`}
              className="bg-ora-teal px-3 py-1 text-[10px] uppercase tracking-wider text-ora-white font-medium hover:bg-ora-teal-dark transition-colors"
            >
              {post.categories[0].name}
            </Link>
          )}
          {post.publishedAt && (
            <time
              dateTime={new Date(post.publishedAt).toISOString()}
              className="text-sm text-ora-charcoal-light"
            >
              {new Date(post.publishedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </time>
          )}
        </div>

        {/* Title + Share */}
        <div className="mt-5 flex items-start justify-between gap-8">
          <h1 className="font-serif text-3xl leading-tight text-ora-charcoal md:text-4xl">
            {post.title}
          </h1>
          <div className="shrink-0 pt-1">
            <ShareButtons postId={post.id} url={postUrl} title={post.title} />
          </div>
        </div>

        {/* Content */}
        <div
          className="prose prose-lg mt-10 max-w-none text-ora-charcoal"
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-ora-sand pt-6">
            <span className="text-xs font-medium text-ora-charcoal-light">Tags:</span>
            {post.tags.map((tag) => (
              <Link
                key={tag.id}
                href={`/blog/tag/${tag.slug}`}
                className="border border-ora-sand px-3 py-1 text-xs text-ora-charcoal-light hover:bg-ora-cream-light transition-colors"
              >
                {tag.name}
              </Link>
            ))}
          </div>
        )}
      </article>

      {/* Other News */}
      {relatedPosts.length > 0 && (
        <section className="mx-auto max-w-7xl px-6 pb-20 md:px-10 lg:px-16">
          <h2 className="font-serif text-2xl text-ora-charcoal md:text-3xl">
            Other News
          </h2>
          <hr className="mt-4 border-ora-sand" />
          <div className="mt-10 grid grid-cols-1 gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {relatedPosts.map((related) => (
              <Link
                key={related.id}
                href={`/blog/${related.slug}`}
                className="group block"
              >
                <div className="relative aspect-4/3 overflow-hidden bg-ora-sand/30">
                  {related.featuredImage && (
                    <img
                      src={related.featuredImage}
                      alt={related.title}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  )}
                  <span className="absolute bottom-3 left-3 bg-ora-teal px-3 py-1 text-[10px] uppercase tracking-wider text-ora-white font-medium">
                    Press Release
                  </span>
                </div>
                <div className="mt-4">
                  {related.publishedAt && (
                    <time
                      dateTime={new Date(related.publishedAt).toISOString()}
                      className="text-xs text-ora-charcoal-light"
                    >
                      {new Date(related.publishedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </time>
                  )}
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <h3 className="text-base font-medium leading-snug text-ora-charcoal">
                      {related.title}
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
        </section>
      )}
    </main>
  );
}
