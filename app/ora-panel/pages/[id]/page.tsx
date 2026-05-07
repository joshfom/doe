'use client';

import { use, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  usePage,
  useUpdatePage,
  usePublishPage,
  useUnpublishPage,
  useRevisions,
  useRollback,
  useSetHomePage,
  useSiteSettings,
  useContentApprovalStatus,
  usePendingDraft,
} from '@/lib/cms/hooks';
import { ApprovalActions } from '@/lib/cms/components/ApprovalActions';
import { ApprovalChainStepper } from '@/lib/cms/components/ApprovalChainStepper';
import {
  PenLine,
  Globe,
  EyeOff,
  Eye,
  RotateCcw,
  Home,
  ChevronRight,
  Save,
  Search,
  FileText,
  Settings,
  ClipboardCheck,
  X,
} from 'lucide-react';

export default function PageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data: page, isLoading } = usePage(id);
  const updatePage = useUpdatePage();
  const publishPage = usePublishPage();
  const unpublishPage = useUnpublishPage();
  const { data: revisions, isLoading: revisionsLoading } = useRevisions(id);
  const rollback = useRollback();
  const setHomePage = useSetHomePage();
  const { data: settingsEntries } = useSiteSettings();
  const [rollbackTarget, setRollbackTarget] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'seo' | 'revisions'>('details');
  const { data: approvalStatus } = useContentApprovalStatus('pages', id);
  const { data: pendingDraftData } = usePendingDraft(id);
  const hasPendingDraft = pendingDraftData !== undefined;
  const [approvalSheetOpen, setApprovalSheetOpen] = useState(false);

  // Editable fields
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [metaKeywords, setMetaKeywords] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [canonicalUrl, setCanonicalUrl] = useState('');
  const [robotsDirective, setRobotsDirective] = useState('index, follow');
  const [seoSaved, setSeoSaved] = useState(false);

  const homePageId = settingsEntries?.find((e) => e.key === 'home_page_id')?.value;

  // Helper to read page fields (handles both camelCase and snake_case from API)
  const pf = (page as unknown as Record<string, unknown>) ?? {};

  // Sync page data into local state
  useEffect(() => {
    if (page) {
      setTitle(page.title ?? '');
      setSlug(page.slug ?? '');
      setMetaTitle((pf.metaTitle ?? pf.meta_title ?? '') as string);
      setMetaDescription((pf.metaDescription ?? pf.meta_description ?? '') as string);
      setMetaKeywords((pf.metaKeywords ?? pf.meta_keywords ?? '') as string);
      setOgImage((pf.ogImage ?? pf.og_image ?? '') as string);
      setCanonicalUrl((pf.canonicalUrl ?? pf.canonical_url ?? '') as string);
      setRobotsDirective((pf.robotsDirective ?? pf.robots_directive ?? 'index, follow') as string);
    }
  }, [page]);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-ora-muted">Loading…</p>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-ora-error">Page not found</p>
      </div>
    );
  }

  const isPublished = page.status === 'published';
  const isPendingReview = page.status === 'pending_review';
  const isHomePage = homePageId === id;

  const handleSaveDetails = async () => {
    await updatePage.mutateAsync({ id, title, slug });
  };

  const handleSaveSeo = async () => {
    await updatePage.mutateAsync({
      id,
      metaTitle,
      metaDescription,
      metaKeywords,
      ogImage,
      canonicalUrl,
      robotsDirective,
    } as any);
    setSeoSaved(true);
    setTimeout(() => setSeoSaved(false), 2000);
  };

  const handleRollback = async (revisionId: string) => {
    await rollback.mutateAsync({ pageId: id, revisionId });
    setRollbackTarget(null);
  };

  const tabs = [
    { key: 'details' as const, label: 'Details', icon: FileText },
    { key: 'seo' as const, label: 'SEO', icon: Search },
    { key: 'revisions' as const, label: 'Revisions', icon: Settings },
  ];

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-ora-muted">
        <Link href="/ora-panel" className="hover:text-ora-charcoal transition-colors">
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <Link href="/ora-panel/pages" className="hover:text-ora-charcoal transition-colors">
          Pages
        </Link>
        <ChevronRight className="h-3.5 w-3.5 stroke-1" />
        <span className="text-ora-charcoal font-medium">{page.title}</span>
      </nav>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-ora-charcoal">{page.title}</h1>
            {isHomePage && (
              <span className="inline-flex items-center gap-1 bg-ora-gold/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-ora-gold-dark">
                <Home className="h-3 w-3 stroke-1" />
                Home
              </span>
            )}
            <span className={`inline-block px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${
              isPublished ? 'bg-ora-success/10 text-ora-success' : 'bg-ora-sand text-ora-charcoal-light'
            }`}>
              {page.status}
            </span>
            {isPendingReview && (
              <span className="inline-block rounded-full bg-ora-warning/10 px-2 py-0.5 text-[10px] font-medium text-ora-warning">Pending Review</span>
            )}
          </div>
          <p className="mt-1 font-mono text-sm text-ora-muted">/{slug}</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/ora-panel/pages/${id}/edit`}
            className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors"
          >
            <PenLine className="h-4 w-4 stroke-1" />
            Edit
          </Link>
          {isPublished ? (
            <button
              onClick={() => unpublishPage.mutate(id)}
              disabled={unpublishPage.isPending}
              className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
            >
              <EyeOff className="h-4 w-4 stroke-1" />
              Unpublish
            </button>
          ) : (
            <button
              onClick={() => publishPage.mutate(id)}
              disabled={publishPage.isPending}
              className="inline-flex h-10 items-center gap-2 bg-ora-gold px-6 text-sm text-ora-white hover:bg-ora-gold-dark transition-colors"
            >
              <Globe className="h-4 w-4 stroke-1" />
              Publish
            </button>
          )}
          {!isHomePage && (
            <button
              onClick={() => setHomePage.mutate(id)}
              disabled={setHomePage.isPending}
              className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-cream px-6 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
            >
              <Home className="h-4 w-4 stroke-1" />
              Set as Home
            </button>
          )}
        </div>
      </div>

      {/* Approval Actions */}
      {approvalStatus?.request && (
        <div className="mb-6">
          <button
            onClick={() => setApprovalSheetOpen(true)}
            className="inline-flex h-10 items-center gap-2 border border-ora-sand bg-ora-white px-5 text-sm text-ora-charcoal hover:bg-ora-cream-light transition-colors"
          >
            <ClipboardCheck className="h-4 w-4 stroke-1" />
            Approval Chain
            <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
              approvalStatus.request.status === 'pending'
                ? 'bg-ora-warning/10 text-ora-warning'
                : approvalStatus.request.status === 'approved'
                  ? 'bg-ora-success/10 text-ora-success'
                  : 'bg-ora-error/10 text-ora-error'
            }`}>
              {approvalStatus.request.status === 'pending'
                ? `Step ${approvalStatus.currentStep ?? 1} of ${approvalStatus.totalSteps ?? 1}`
                : approvalStatus.request.status}
            </span>
          </button>
        </div>
      )}

      {/* Approval Sheet — slides in from right at 50% width */}
      {approvalSheetOpen && approvalStatus?.request && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setApprovalSheetOpen(false)}
          />
          {/* Sheet */}
          <div className="fixed inset-y-0 right-0 z-50 w-1/2 min-w-[400px] max-w-[700px] bg-ora-white shadow-2xl border-l border-ora-sand overflow-y-auto animate-in slide-in-from-right duration-200">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ora-sand bg-ora-white px-6 py-4">
              <h2 className="text-lg font-semibold text-ora-charcoal">Approval Chain</h2>
              <button
                onClick={() => setApprovalSheetOpen(false)}
                className="flex h-8 w-8 items-center justify-center text-ora-muted hover:text-ora-charcoal transition-colors"
              >
                <X className="h-5 w-5 stroke-1" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Approval Actions (approve/reject buttons) */}
              <ApprovalActions contentId={id} contentModule="pages" />

              {/* Chain Stepper with approve-on-behalf */}
              {approvalStatus.chain && approvalStatus.chain.length > 0 && (
                <div className="border border-ora-sand/60 bg-ora-white p-5">
                  <h3 className="mb-4 text-sm font-semibold text-ora-charcoal">Chain Progress</h3>
                  <ApprovalChainStepper
                    chain={approvalStatus.chain}
                    decisions={approvalStatus.decisions ?? []}
                    currentStep={approvalStatus.currentStep ?? 1}
                    totalSteps={approvalStatus.totalSteps ?? 1}
                    requestStatus={approvalStatus.request.status as 'pending' | 'approved' | 'rejected'}
                    requestId={approvalStatus.request.id}
                  />
                </div>
              )}

              {/* Preview Links */}
              {hasPendingDraft && (
                <div className="flex items-center gap-3 border border-ora-sand/60 bg-ora-cream-light p-4">
                  <span className="text-sm font-medium text-ora-charcoal">Pending draft:</span>
                  <a
                    href={`/ora-panel/pages/${id}/preview-pending`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 bg-ora-gold px-4 py-2 text-sm text-ora-white hover:bg-ora-gold-dark transition-colors"
                  >
                    <Eye className="h-3.5 w-3.5 stroke-1" />
                    Preview
                  </a>
                  <a
                    href={`/ora-panel/pages/${id}/preview-live`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 border border-ora-sand bg-ora-cream px-4 py-2 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
                  >
                    <Globe className="h-3.5 w-3.5 stroke-1" />
                    View Live
                  </a>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border border-ora-sand bg-ora-white p-1 w-fit">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
              activeTab === key
                ? 'bg-ora-charcoal text-white'
                : 'text-ora-charcoal-light hover:bg-ora-cream-light'
            }`}
          >
            <Icon className="h-3.5 w-3.5 stroke-1" />
            {label}
          </button>
        ))}
      </div>

      {/* Details Tab */}
      {activeTab === 'details' && (
        <div className="space-y-6">
          {/* Metadata cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Locale', value: page.locale.toUpperCase() },
              { label: 'Created', value: new Date(page.createdAt).toLocaleDateString() },
              { label: 'Updated', value: new Date(page.updatedAt).toLocaleDateString() },
              { label: 'Published', value: page.publishedAt ? new Date(page.publishedAt).toLocaleDateString() : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="border border-ora-sand/60 bg-ora-white p-4">
                <span className="text-xs text-ora-muted">{label}</span>
                <p className="mt-1 text-sm font-medium text-ora-charcoal">{value}</p>
              </div>
            ))}
          </div>

          {/* Editable title and slug */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <h3 className="mb-4 text-sm font-semibold text-ora-charcoal">Page Settings</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                  Page Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                  Slug
                </label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 font-mono text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleSaveDetails}
                disabled={updatePage.isPending}
                className="inline-flex h-9 items-center gap-2 bg-ora-charcoal px-5 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5 stroke-1" />
                {updatePage.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SEO Tab */}
      {activeTab === 'seo' && (
        <div className="space-y-6">
          {/* Meta basics */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <h3 className="mb-1 text-sm font-semibold text-ora-charcoal">Meta Tags</h3>
            <p className="mb-5 text-xs text-ora-muted">Controls how this page appears in search results.</p>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Meta Title</label>
                <input
                  type="text"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder="Page title for search engines"
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                />
                <p className="mt-1 text-xs text-ora-muted">{metaTitle.length}/60 characters</p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Meta Description</label>
                <textarea
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder="Brief description for search results"
                  rows={3}
                  className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y"
                />
                <p className="mt-1 text-xs text-ora-muted">{metaDescription.length}/160 characters</p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Keywords</label>
                <input
                  type="text"
                  value={metaKeywords}
                  onChange={(e) => setMetaKeywords(e.target.value)}
                  placeholder="keyword1, keyword2, keyword3"
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                />
                <p className="mt-1 text-xs text-ora-muted">Comma-separated keywords</p>
              </div>
            </div>
          </div>

          {/* Open Graph / Social */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <h3 className="mb-1 text-sm font-semibold text-ora-charcoal">Social Sharing</h3>
            <p className="mb-5 text-xs text-ora-muted">Controls how this page appears when shared on social media.</p>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">OG Image URL</label>
              <input
                type="text"
                value={ogImage}
                onChange={(e) => setOgImage(e.target.value)}
                placeholder="/uploads/og-image.jpg"
                className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              />
              <p className="mt-1 text-xs text-ora-muted">Recommended: 1200×630px</p>
              {ogImage && (
                <div className="mt-3 border border-ora-sand bg-ora-cream-light p-2">
                  <img src={ogImage} alt="OG preview" className="max-h-32 object-contain" />
                </div>
              )}
            </div>
          </div>

          {/* Advanced */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <h3 className="mb-1 text-sm font-semibold text-ora-charcoal">Advanced</h3>
            <p className="mb-5 text-xs text-ora-muted">Canonical URL and robots directives.</p>

            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Canonical URL</label>
                <input
                  type="text"
                  value={canonicalUrl}
                  onChange={(e) => setCanonicalUrl(e.target.value)}
                  placeholder="Leave empty to use default URL"
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Robots Directive</label>
                <select
                  value={robotsDirective}
                  onChange={(e) => setRobotsDirective(e.target.value)}
                  className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
                >
                  <option value="index, follow">Index, Follow (default)</option>
                  <option value="noindex, follow">No Index, Follow</option>
                  <option value="index, nofollow">Index, No Follow</option>
                  <option value="noindex, nofollow">No Index, No Follow</option>
                </select>
              </div>
            </div>
          </div>

          {/* Search preview */}
          <div className="border border-ora-sand/60 bg-ora-white p-6">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-ora-muted">Search Preview</p>
            <div>
              <p className="text-base text-blue-700">{metaTitle || title || 'Page Title'}</p>
              <p className="text-xs text-green-700 font-mono">/{slug === '/' ? '' : slug}</p>
              <p className="mt-1 text-sm text-ora-charcoal-light line-clamp-2">
                {metaDescription || 'No description set.'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            {seoSaved && <span className="text-sm text-ora-success">Saved</span>}
            <button
              onClick={handleSaveSeo}
              disabled={updatePage.isPending}
              className="inline-flex h-9 items-center gap-2 bg-ora-charcoal px-5 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5 stroke-1" />
              {updatePage.isPending ? 'Saving…' : 'Save SEO'}
            </button>
          </div>
        </div>
      )}

      {/* Revisions Tab */}
      {activeTab === 'revisions' && (
        <div>
          {revisionsLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse bg-ora-sand/60" />
              ))}
            </div>
          ) : !revisions?.length ? (
            <div className="border border-ora-sand/60 bg-ora-white p-8 text-center">
              <p className="text-sm text-ora-muted">No revisions yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {revisions.map((rev) => (
                <div
                  key={rev.id}
                  className="flex items-center justify-between border border-ora-sand/60 bg-ora-white p-4"
                >
                  <div>
                    <span className="text-sm font-medium text-ora-charcoal">
                      Revision #{rev.revisionNumber}
                    </span>
                    <span className="ml-3 text-xs text-ora-muted">
                      {new Date(rev.createdAt).toLocaleString()}
                    </span>
                    {rev.action === 'rollback' && (
                      <span className="ml-2 inline-block rounded-full bg-ora-warning/10 px-2 py-0.5 text-xs font-medium text-ora-warning">
                        rollback
                      </span>
                    )}
                  </div>
                  {rollbackTarget === rev.id ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRollback(rev.id)}
                        disabled={rollback.isPending}
                        className="h-9 bg-ora-gold px-5 text-sm text-ora-white hover:bg-ora-gold-dark transition-colors"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setRollbackTarget(null)}
                        className="h-9 border border-ora-sand bg-ora-cream px-5 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setRollbackTarget(rev.id)}
                      className="inline-flex h-9 items-center gap-1.5 border border-ora-sand bg-ora-cream px-5 text-sm text-ora-charcoal hover:bg-ora-cream-dark transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5 stroke-1" />
                      Rollback
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
