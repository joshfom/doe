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
    <main className="mx-auto max-w-4xl px-4 py-12">
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      <article>
        {/* Categories */}
        {post.categories && post.categories.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {post.categories.map((cat) => (
              <Link
                key={cat.id}
                href={`/blog/category/${cat.slug}`}
                className="inline-block rounded-full bg-ora-gold/10 px-3 py-0.5 text-xs font-medium text-ora-gold-dark hover:bg-ora-gold/20 transition-colors"
              >
                {cat.name}
              </Link>
            ))}
          </div>
        )}

        {/* Title */}
        <h1 className="text-3xl font-semibold text-ora-charcoal-dark leading-tight">
          {post.title}
        </h1>

        {/* Meta */}
        <div className="mt-4 flex items-center gap-3 text-xs text-ora-muted">
          {post.author?.name && <span>{post.author.name}</span>}
          {post.publishedAt && (
            <>
              <span>·</span>
              <time dateTime={new Date(post.publishedAt).toISOString()}>
                {new Date(post.publishedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
            </>
          )}
        </div>

        {/* Share Buttons */}
        <div className="mt-6">
          <ShareButtons postId={post.id} url={postUrl} title={post.title} />
        </div>

        {/* Featured Image */}
        {post.featuredImage && (
          <div className="mt-8 overflow-hidden">
            <img
              src={post.featuredImage}
              alt={post.title}
              className="w-full object-cover"
            />
          </div>
        )}

        {/* Content */}
        <div
          className="prose prose-lg mt-8 max-w-none text-ora-charcoal"
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

      {/* Related Posts */}
      {relatedPosts.length > 0 && (
        <section className="mt-16 border-t border-ora-sand pt-10">
          <h2 className="text-xl font-semibold text-ora-charcoal mb-6">Related Posts</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {relatedPosts.map((related) => (
              <Link
                key={related.id}
                href={`/blog/${related.slug}`}
                className="group border border-ora-sand/60 bg-ora-white transition-colors hover:border-ora-sand"
              >
                {related.featuredImage && (
                  <div className="aspect-video overflow-hidden">
                    <img
                      src={related.featuredImage}
                      alt={related.title}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-ora-charcoal group-hover:text-ora-gold-dark transition-colors">
                    {related.title}
                  </h3>
                  {related.publishedAt && (
                    <time
                      dateTime={new Date(related.publishedAt).toISOString()}
                      className="mt-2 block text-xs text-ora-muted"
                    >
                      {new Date(related.publishedAt).toLocaleDateString("en-US", {
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
        </section>
      )}
    </main>
  );
}
