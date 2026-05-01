'use client';

import { use, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  usePost,
  useUpdatePost,
  useDeletePost,
  usePublishPost,
  useUnpublishPost,
  useClonePostLocale,
  usePostRevisions,
  useRollbackPost,
  useBlogCategories,
  useBlogTags,
  useContentApprovalStatus,
} from '@/lib/cms/hooks';
import { ApprovalActions } from '@/lib/cms/components/ApprovalActions';
import { TiptapEditor } from '@/lib/cms/components/TiptapEditor';
import { MediaPickerModal } from '@/lib/cms/components/MediaPickerModal';
import type { CategoryTree } from '@/lib/cms/types';
import {
  ChevronRight,
  ChevronDown,
  Globe,
  EyeOff,
  Trash2,
  RotateCcw,
  Save,
  Copy,
  Image as ImageIcon,
  X,
  FileText,
  Search,
  Settings,
} from 'lucide-react';

export default function PostEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { data: post, isLoading } = usePost(id);
  const updatePost = useUpdatePost();
  const deletePost = useDeletePost();
  const publishPost = usePublishPost();
  const unpublishPost = useUnpublishPost();
  const cloneLocale = useClonePostLocale();
  const { data: revisions, isLoading: revisionsLoading } = usePostRevisions(id);
  const rollback = useRollbackPost();
  const { data: categories } = useBlogCategories();
  const { data: allTags } = useBlogTags();
  const { data: approvalStatus } = useContentApprovalStatus('blog', id);

  const [activeTab, setActiveTab] = useState<'editor' | 'seo' | 'revisions'>('editor');
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState<Record<string, unknown>>({ type: 'doc', content: [{ type: 'paragraph' }] });
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
  const [saved, setSaved] = useState(false);

  // Sync post data
  useEffect(() => {
    if (!post) return;
    const p = post as Record<string, any>;
    setTitle(p.title ?? '');
    setContent(p.content ?? { type: 'doc', content: [{ type: 'paragraph' }] });
    setExcerpt(p.excerpt ?? '');
    setFeaturedImage(p.featuredImage ?? p.featured_image ?? '');
    setOgImage(p.ogImage ?? p.og_image ?? '');
    setMetaTitle(p.metaTitle ?? p.meta_title ?? '');
    setMetaDescription(p.metaDescription ?? p.meta_description ?? '');
    setMetaKeywords(p.metaKeywords ?? p.meta_keywords ?? '');
    setCanonicalUrl(p.canonicalUrl ?? p.canonical_url ?? '');
    setRobotsDirective(p.robotsDirective ?? p.robots_directive ?? 'index, follow');
    setSelectedCategories((p.categories ?? []).map((c: any) => c.id));
    setSelectedTags((p.tags ?? []).map((t: any) => t.name));
  }, [post]);

  const filteredTags = (allTags ?? []).filter(
    (t) => !selectedTags.includes(t.name) && t.name.toLowerCase().includes(tagInput.toLowerCase())
  );

  const addTag = (name: string) => {
    if (!selectedTags.includes(name)) setSelectedTags([...selectedTags, name]);
    setTagInput('');
  };
  const removeTag = (name: string) => setSelectedTags(selectedTags.filter((t) => t !== name));
  const toggleCategory = (catId: string) =>
    setSelectedCategories((prev) => prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId]);

  const handleSave = async () => {
    await updatePost.mutateAsync({
      id,
      title,
      content,
      excerpt: excerpt || undefined,
      featuredImage: featuredImage || undefined,
      metaTitle: metaTitle || undefined,
      metaDescription: metaDescription || undefined,
      metaKeywords: metaKeywords || undefined,
      ogImage: ogImage || undefined,
      canonicalUrl: canonicalUrl || undefined,
      robotsDirective,
    } as any);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTrash = async () => {
    await deletePost.mutateAsync(id);
    router.push('/ora-panel/blog');
  };

  const handleRollback = async (revisionId: string) => {
    await rollback.mutateAsync({ postId: id, revisionId });
    setRollbackTarget(null);
  };

  const renderCategoryTree = (nodes: CategoryTree[], depth = 0) =>
    nodes.map((cat) => (
      <div key={cat.id}>
        <label className="flex items-center gap-2 py-1 cursor-pointer hover:bg-ora-cream-light px-2" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
          <input type="checkbox" checked={selectedCategories.includes(cat.id)} onChange={() => toggleCategory(cat.id)} className="accent-ora-gold" />
          <span className="text-sm text-ora-charcoal">{cat.name}</span>
        </label>
        {cat.children?.length > 0 && renderCategoryTree(cat.children, depth + 1)}
      </div>
    ));

  if (isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center"><p className="text-sm text-ora-muted">Loading…</p></div>;
  }
  if (!post) {
    return <div className="flex min-h-[40vh] items-center justify-center"><p className="text-sm text-ora-error">Post not found</p></div>;
  }

  const isPublished = post.status === 'published';
  const isPendingReview = post.status === 'pending_review';
  const pf = post as Record<string, any>;
  const postLocale = pf.locale ?? 'en';

  const tabs = [
    { key: 'editor' as const, label: 'Editor', icon: FileText },
    { key: 'seo' as const, label: 'SEO', icon: Search },
    { key: 'revisions' as const, label: 'Revisions', icon: Settings },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">Dashboard</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/blog" className="hover:text-ora-charcoal transition-colors">Blog</Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">{post.title}</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-ora-charcoal">{post.title}</h1>
            <span className={`inline-block px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
              isPublished ? 'bg-ora-success/10 text-ora-success' : 'bg-ora-sand text-ora-charcoal-light'
            }`}>{post.status}</span>
            {isPendingReview && (
              <span className="inline-block rounded-full bg-ora-warning/10 px-2 py-0.5 text-[10px] font-medium text-ora-warning">Pending Review</span>
            )}
            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
              pf.postType === 'news' ? 'bg-ora-info/10 text-ora-info' : 'bg-ora-gold/10 text-ora-gold-dark'
            }`}>{pf.postType ?? 'blog'}</span>
          </div>
          <p className="mt-1 font-mono text-sm text-ora-muted">/{pf.slug}</p>
        </div>
        <div className="flex gap-2">
          {isPublished ? (
            <button onClick={() => unpublishPost.mutate(id)} disabled={unpublishPost.isPending} className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">
              <EyeOff className="h-4 w-4 stroke-1" /> Unpublish
            </button>
          ) : (
            <button onClick={() => publishPost.mutate(id)} disabled={publishPost.isPending} className="inline-flex h-10 items-center gap-2 bg-ora-gold px-6 text-sm text-ora-white hover:bg-ora-gold-dark transition-colors">
              <Globe className="h-4 w-4 stroke-1" /> Publish
            </button>
          )}
          {postLocale === 'en' && (
            <button onClick={() => cloneLocale.mutate(id)} disabled={cloneLocale.isPending} className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">
              <Copy className="h-4 w-4 stroke-1" /> Clone to AR
            </button>
          )}
          <button onClick={handleTrash} disabled={deletePost.isPending} className="inline-flex h-10 items-center gap-2 bg-ora-error/10 px-6 text-sm text-ora-error hover:bg-ora-error/20 transition-colors">
            <Trash2 className="h-4 w-4 stroke-1" /> Trash
          </button>
        </div>
      </div>

      {/* Approval Actions */}
      {approvalStatus?.request && (
        <div className="mb-6">
          <ApprovalActions contentId={id} contentModule="blog" />
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border border-ora-sand bg-ora-white p-1 w-fit">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)} className={`inline-flex items-center gap-2 px-4 py-2 text-sm transition-colors ${activeTab === key ? 'bg-ora-charcoal text-white' : 'text-ora-charcoal-light hover:bg-ora-cream-light'}`}>
            <Icon className="h-3.5 w-3.5 stroke-1" /> {label}
          </button>
        ))}
      </div>

      {/* Editor Tab */}
      {activeTab === 'editor' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {/* Title */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Title</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
            </div>

            {/* Content */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-3 block text-xs font-medium text-ora-charcoal-light">Content</label>
              <TiptapEditor content={content} onChange={setContent} />
            </div>

            {/* Excerpt */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Excerpt</label>
              <textarea value={excerpt} onChange={(e) => setExcerpt(e.target.value)} placeholder="Brief summary…" rows={3} className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y" />
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
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
                <button type="button" onClick={() => setFeaturedPickerOpen(true)} className="flex w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-ora-sand py-8 text-ora-muted hover:border-ora-gold hover:text-ora-gold-dark transition-colors">
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
                <div>
                  <img src={featuredImage} alt="OG (from featured)" className="w-full aspect-video object-cover border border-ora-sand opacity-60" />
                  <p className="mt-1 text-[10px] text-ora-muted">Using featured image as default</p>
                  <button type="button" onClick={() => setOgPickerOpen(true)} className="mt-2 text-xs text-ora-gold hover:text-ora-gold-dark transition-colors">Set custom OG image</button>
                </div>
              ) : (
                <button type="button" onClick={() => setOgPickerOpen(true)} className="flex w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-ora-sand py-8 text-ora-muted hover:border-ora-gold hover:text-ora-gold-dark transition-colors">
                  <ImageIcon className="h-8 w-8 stroke-1" />
                  <span className="text-xs">Click to select OG image</span>
                </button>
              )}
            </div>

            {/* Categories */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-3 block text-xs font-medium text-ora-charcoal-light">Categories</label>
              <div className="max-h-48 overflow-y-auto border border-ora-sand">
                {categories?.length ? renderCategoryTree(categories) : <p className="p-3 text-xs text-ora-muted">No categories yet</p>}
              </div>
            </div>

            {/* Tags */}
            <div className="border border-ora-sand/60 bg-ora-white p-6">
              <label className="mb-3 block text-xs font-medium text-ora-charcoal-light">Tags</label>
              <div className="relative">
                <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && tagInput.trim()) { e.preventDefault(); addTag(tagInput.trim()); } }} placeholder="Type to search tags…" className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none" />
                {tagInput && filteredTags.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full border border-ora-sand bg-ora-white shadow-ora-md max-h-32 overflow-y-auto">
                    {filteredTags.slice(0, 8).map((t) => (
                      <button key={t.id} type="button" onClick={() => addTag(t.name)} className="block w-full px-3 py-2 text-left text-sm text-ora-charcoal hover:bg-ora-cream-light transition-colors">{t.name}</button>
                    ))}
                  </div>
                )}
              </div>
              {selectedTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedTags.map((name) => (
                    <span key={name} className="inline-flex items-center gap-1 bg-ora-sand/50 px-2.5 py-1 text-xs text-ora-charcoal">
                      {name}
                      <button type="button" onClick={() => removeTag(name)} className="text-ora-muted hover:text-ora-charcoal"><X className="h-3 w-3 stroke-1" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Save */}
            <div className="flex items-center gap-3">
              {saved && <span className="text-sm text-ora-success">Saved</span>}
              <button onClick={handleSave} disabled={updatePost.isPending} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-ora-charcoal text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50">
                <Save className="h-3.5 w-3.5 stroke-1" /> {updatePost.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEO Tab */}
      {activeTab === 'seo' && (
        <div className="space-y-6 max-w-2xl">
          <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
            <h3 className="text-sm font-semibold text-ora-charcoal">Meta Tags</h3>
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
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-sm text-ora-success">Saved</span>}
            <button onClick={handleSave} disabled={updatePost.isPending} className="inline-flex h-9 items-center gap-2 bg-ora-charcoal px-5 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50">
              <Save className="h-3.5 w-3.5 stroke-1" /> {updatePost.isPending ? 'Saving…' : 'Save SEO'}
            </button>
          </div>
        </div>
      )}

      {/* Revisions Tab */}
      {activeTab === 'revisions' && (
        <div>
          {revisionsLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse bg-ora-sand/60" />)}</div>
          ) : !revisions?.length ? (
            <div className="border border-ora-sand/60 bg-ora-white p-8 text-center"><p className="text-sm text-ora-muted">No revisions yet</p></div>
          ) : (
            <div className="space-y-2">
              {revisions.map((rev) => (
                <div key={rev.id} className="flex items-center justify-between border border-ora-sand/60 bg-ora-white p-4">
                  <div>
                    <span className="text-sm font-medium text-ora-charcoal">Revision #{rev.revisionNumber}</span>
                    <span className="ml-3 text-xs text-ora-muted">{new Date(rev.createdAt).toLocaleString()}</span>
                    <span className="ml-2 text-xs text-ora-muted">— {rev.titleSnapshot}</span>
                    {rev.action === 'rollback' && (
                      <span className="ml-2 inline-block rounded-full bg-ora-warning/10 px-2 py-0.5 text-xs font-medium text-ora-warning">rollback</span>
                    )}
                  </div>
                  {rollbackTarget === rev.id ? (
                    <div className="flex gap-2">
                      <button onClick={() => handleRollback(rev.id)} disabled={rollback.isPending} className="h-9 bg-ora-gold px-5 text-sm text-ora-white hover:bg-ora-gold-dark transition-colors">Confirm</button>
                      <button onClick={() => setRollbackTarget(null)} className="h-9 border border-ora-sand bg-ora-cream px-5 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setRollbackTarget(rev.id)} className="inline-flex h-9 items-center gap-1.5 border border-ora-sand bg-ora-cream px-5 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors">
                      <RotateCcw className="h-3.5 w-3.5 stroke-1" /> Restore
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <MediaPickerModal open={featuredPickerOpen} onClose={() => setFeaturedPickerOpen(false)} onSelect={setFeaturedImage} mimeTypeFilter="image/" />
      <MediaPickerModal open={ogPickerOpen} onClose={() => setOgPickerOpen(false)} onSelect={setOgImage} mimeTypeFilter="image/" />
    </div>
  );
}
