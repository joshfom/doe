'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useCreatePost,
  useBlogCategories,
  useBlogTags,
} from '@/lib/cms/hooks';
import { TiptapEditor } from '@/lib/cms/components/TiptapEditor';
import { MediaPickerModal } from '@/lib/cms/components/MediaPickerModal';
import { generateSlug } from '@/lib/cms/utils/slug';
import type { Locale, PostType, CategoryTree } from '@/lib/cms/types';
import {
  ChevronRight,
  ChevronDown,
  Image as ImageIcon,
  X,
} from 'lucide-react';

export default function NewPostPage() {
  const router = useRouter();
  const createPost = useCreatePost();
  const { data: categories } = useBlogCategories();
  const { data: tags } = useBlogTags();

  // Form state
  const [title, setTitle] = useState('');
  const [postType, setPostType] = useState<PostType>('blog');
  const [locale, setLocale] = useState<Locale>('en');
  const [content, setContent] = useState<Record<string, unknown>>({
    type: 'doc',
    content: [{ type: 'paragraph' }],
  });
  const [excerpt, setExcerpt] = useState('');
  const [featuredImage, setFeaturedImage] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // SEO
  const [seoOpen, setSeoOpen] = useState(false);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [metaKeywords, setMetaKeywords] = useState('');
  const [canonicalUrl, setCanonicalUrl] = useState('');
  const [robotsDirective, setRobotsDirective] = useState('index, follow');

  // Media picker
  const [featuredPickerOpen, setFeaturedPickerOpen] = useState(false);
  const [ogPickerOpen, setOgPickerOpen] = useState(false);

  const slug = generateSlug(title);

  // Tag autocomplete
  const filteredTags = (tags ?? []).filter(
    (t) =>
      !selectedTags.includes(t.name) &&
      t.name.toLowerCase().includes(tagInput.toLowerCase())
  );

  const addTag = (name: string) => {
    if (!selectedTags.includes(name)) {
      setSelectedTags([...selectedTags, name]);
    }
    setTagInput('');
  };

  const removeTag = (name: string) => {
    setSelectedTags(selectedTags.filter((t) => t !== name));
  };

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      const post = await createPost.mutateAsync({
        title: title.trim(),
        postType,
        locale,
        content,
        excerpt: excerpt || undefined,
        featuredImage: featuredImage || undefined,
        metaTitle: metaTitle || undefined,
        metaDescription: metaDescription || undefined,
        metaKeywords: metaKeywords || undefined,
        ogImage: ogImage || undefined,
        canonicalUrl: canonicalUrl || undefined,
        robotsDirective,
      });
      router.push(`/ora-panel/blog/${post.id}`);
    } catch {
      // error handled by mutation state
    }
  };

  const renderCategoryTree = (nodes: CategoryTree[], depth = 0) =>
    nodes.map((cat) => (
      <div key={cat.id}>
        <label
          className="flex items-center gap-2 py-1 cursor-pointer hover:bg-ora-cream-light px-2"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <input
            type="checkbox"
            checked={selectedCategories.includes(cat.id)}
            onChange={() => toggleCategory(cat.id)}
            className="accent-ora-gold"
          />
          <span className="text-sm text-ora-charcoal">{cat.name}</span>
        </label>
        {cat.children?.length > 0 && renderCategoryTree(cat.children, depth + 1)}
      </div>
    ));

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Feed</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/blog" className="hover:text-ora-charcoal transition-colors">Blog</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">New Post</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">New Post</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Create a new blog post or news article</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Title */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Post title"
                required
                className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              />
              <div className="mt-2 flex h-8 items-center border border-ora-sand bg-ora-cream-light px-3 font-mono text-xs text-ora-muted">
                /{slug || '…'}
              </div>
            </div>

            {/* Content */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-3 block text-xs font-medium text-ora-charcoal-light">Content</label>
              <TiptapEditor content={content} onChange={setContent} />
            </div>

            {/* Excerpt */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Excerpt</label>
              <textarea
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="Brief summary for listings…"
                rows={3}
                className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y"
              />
            </div>

            {/* SEO Panel */}
            <div className="border border-ora-sand/60 bg-ora-white">
              <button
                type="button"
                onClick={() => setSeoOpen(!seoOpen)}
                className="flex w-full items-center justify-between p-6 text-left"
              >
                <span className="text-sm font-semibold text-ora-charcoal">SEO Settings</span>
                <ChevronDown className={`h-4 w-4 stroke-1 text-ora-muted transition-transform ${seoOpen ? 'rotate-180' : ''}`} />
              </button>
              {seoOpen && (
                <div className="border-t border-ora-sand px-6 pb-6 pt-4 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Meta Title</label>
                    <input type="text" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder="Page title for search engines" className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
                    <p className="mt-1 text-xs text-ora-muted">{metaTitle.length}/60 characters</p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Meta Description</label>
                    <textarea value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder="Brief description for search results" rows={3} className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y" />
                    <p className="mt-1 text-xs text-ora-muted">{metaDescription.length}/160 characters</p>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Meta Keywords</label>
                    <input type="text" value={metaKeywords} onChange={(e) => setMetaKeywords(e.target.value)} placeholder="keyword1, keyword2, keyword3" className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Canonical URL</label>
                    <input type="text" value={canonicalUrl} onChange={(e) => setCanonicalUrl(e.target.value)} placeholder="Leave empty to use default URL" className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Robots Directive</label>
                    <select value={robotsDirective} onChange={(e) => setRobotsDirective(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                      <option value="index, follow">Index, Follow (default)</option>
                      <option value="noindex, follow">No Index, Follow</option>
                      <option value="index, nofollow">Index, No Follow</option>
                      <option value="noindex, nofollow">No Index, No Follow</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Post Type & Locale */}
            <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Post Type</label>
                <select value={postType} onChange={(e) => setPostType(e.target.value as PostType)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                  <option value="blog">Blog</option>
                  <option value="news">News</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Locale</label>
                <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none">
                  <option value="en">English (EN)</option>
                  <option value="ar">Arabic (AR)</option>
                </select>
              </div>
            </div>

            {/* Featured Image */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-3 block text-xs font-medium text-ora-charcoal-light">Featured Image</label>
              {featuredImage ? (
                <div className="relative">
                  <img src={featuredImage} alt="Featured" className="w-full aspect-video object-cover border border-ora-sand" />
                  <button type="button" onClick={() => setFeaturedImage('')} className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center bg-ora-charcoal/70 text-white hover:bg-ora-charcoal transition-colors">
                    <X className="h-3.5 w-3.5 stroke-1" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setFeaturedPickerOpen(true)}
                  className="flex w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-ora-sand py-8 text-ora-muted hover:border-ora-gold hover:text-ora-gold-dark transition-colors"
                >
                  <ImageIcon className="h-8 w-8 stroke-1" />
                  <span className="text-xs">Click to select image</span>
                </button>
              )}
            </div>

            {/* OG Image */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-3 block text-xs font-medium text-ora-charcoal-light">OG Image</label>
              {ogImage ? (
                <div className="relative">
                  <img src={ogImage} alt="OG" className="w-full aspect-video object-cover border border-ora-sand" />
                  <button type="button" onClick={() => setOgImage('')} className="absolute top-2 right-2 h-6 w-6 flex items-center justify-center bg-ora-charcoal/70 text-white hover:bg-ora-charcoal transition-colors">
                    <X className="h-3.5 w-3.5 stroke-1" />
                  </button>
                </div>
              ) : featuredImage ? (
                <div className="relative">
                  <img src={featuredImage} alt="OG (from featured)" className="w-full aspect-video object-cover border border-ora-sand opacity-60" />
                  <p className="mt-1 text-[10px] text-ora-muted">Using featured image as default</p>
                  <button type="button" onClick={() => setOgPickerOpen(true)} className="mt-2 text-xs text-ora-gold hover:text-ora-gold-dark transition-colors">
                    Set custom OG image
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setOgPickerOpen(true)}
                  className="flex w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-ora-sand py-8 text-ora-muted hover:border-ora-gold hover:text-ora-gold-dark transition-colors"
                >
                  <ImageIcon className="h-8 w-8 stroke-1" />
                  <span className="text-xs">Click to select OG image</span>
                </button>
              )}
            </div>

            {/* Categories */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-3 block text-xs font-medium text-ora-charcoal-light">Categories</label>
              <div className="max-h-48 overflow-y-auto border border-ora-sand">
                {categories?.length ? renderCategoryTree(categories) : (
                  <p className="p-3 text-xs text-ora-muted">No categories yet</p>
                )}
              </div>
            </div>

            {/* Tags */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-3 block text-xs font-medium text-ora-charcoal-light">Tags</label>
              <div className="relative">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && tagInput.trim()) {
                      e.preventDefault();
                      addTag(tagInput.trim());
                    }
                  }}
                  placeholder="Type to search tags…"
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                />
                {tagInput && filteredTags.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full border border-ora-sand bg-ora-white shadow-ora-md max-h-32 overflow-y-auto">
                    {filteredTags.slice(0, 8).map((t) => (
                      <button key={t.id} type="button" onClick={() => addTag(t.name)} className="block w-full px-3 py-2 text-left text-sm text-ora-charcoal hover:bg-ora-cream-light transition-colors">
                        {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selectedTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedTags.map((name) => (
                    <span key={name} className="inline-flex items-center gap-1 bg-ora-sand/50 px-2.5 py-1 text-xs text-ora-charcoal">
                      {name}
                      <button type="button" onClick={() => removeTag(name)} className="text-ora-muted hover:text-ora-charcoal">
                        <X className="h-3 w-3 stroke-1" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Submit */}
            <div className="space-y-3">
              {createPost.isError && (
                <p className="text-sm text-ora-error">Failed to create post. Please try again.</p>
              )}
              <button
                type="submit"
                disabled={createPost.isPending || !title.trim()}
                className="h-10 w-full bg-ora-charcoal text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
              >
                {createPost.isPending ? 'Creating…' : 'Create Post'}
              </button>
            </div>
          </div>
        </div>
      </form>

      <MediaPickerModal open={featuredPickerOpen} onClose={() => setFeaturedPickerOpen(false)} onSelect={setFeaturedImage} mimeTypeFilter="image/" />
      <MediaPickerModal open={ogPickerOpen} onClose={() => setOgPickerOpen(false)} onSelect={setOgImage} mimeTypeFilter="image/" />
    </div>
  );
}
