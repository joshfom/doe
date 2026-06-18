'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useSiteSettings, useUpdateSettings } from '@/lib/cms/hooks';
import { useApprovalConfig, useUpdateApprovalConfig } from '@/lib/cms/hooks/use-approvals';
import { useUsers } from '@/lib/cms/hooks/use-users';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Settings, CheckSquare, BrainCircuit, Mail } from 'lucide-react';
import type { ContentModule } from '@/lib/cms/types';
import { OrderedApproverList } from '@/lib/cms/components/OrderedApproverList';
import { ListSkeleton, DetailFormSkeleton } from '@/components/ui/panel-skeletons';

// ── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'approval', label: 'Content Approval', icon: CheckSquare },
  { key: 'ai', label: 'AI Configuration', icon: BrainCircuit },
  { key: 'email', label: 'Email', icon: Mail },
] as const;

type TabKey = (typeof TABS)[number]['key'];

// ── Constants ────────────────────────────────────────────────────────────────

const SETTING_KEYS = [
  { key: 'company_name', label: 'Company Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Address' },
  { key: 'social_facebook', label: 'Facebook URL' },
  { key: 'social_instagram', label: 'Instagram URL' },
  { key: 'social_twitter', label: 'Twitter / X URL' },
  { key: 'social_linkedin', label: 'LinkedIn URL' },
];

const NAV_SETTING_KEYS = [
  { key: 'nav_cta_label', label: 'Navigation CTA Label' },
  { key: 'nav_cta_url', label: 'Navigation CTA URL' },
];

const URL_SETTING_KEYS = [
  {
    key: 'project_slug_prefix',
    label: 'Project URL prefix (EN)',
    placeholder: 'projects',
    hint: 'e.g. "projects" → /projects/<slug>. Use "developments" for /developments/<slug>.',
  },
  {
    key: 'project_slug_prefix_ar',
    label: 'Project URL prefix (AR)',
    placeholder: 'مشاريع',
    hint: 'Used for the Arabic locale: /ar/<prefix>/<slug>.',
  },
  {
    key: 'community_slug_prefix',
    label: 'Community URL prefix (EN)',
    placeholder: 'communities',
    hint: 'e.g. "communities" → /communities/<slug>.',
  },
  {
    key: 'community_slug_prefix_ar',
    label: 'Community URL prefix (AR)',
    placeholder: 'مجتمعات',
    hint: 'Used for the Arabic locale: /ar/<prefix>/<slug>.',
  },
];

const CONTENT_MODULES: { key: ContentModule; label: string }[] = [
  { key: 'pages', label: 'Pages' },
  { key: 'blog', label: 'Blog' },
  { key: 'news', label: 'News' },
  { key: 'construction_updates', label: 'Construction Updates' },
];

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get('tab') as TabKey | null;
  const [activeTab, setActiveTab] = useState<TabKey>(tabParam && TABS.some(t => t.key === tabParam) ? tabParam : 'general');

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    router.replace(`/ora-panel/settings?tab=${tab}`, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">General Settings</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Manage your platform configuration</p>
      </div>

      {/* Tab navigation */}
      <div className="mb-6 flex gap-1 border-b border-ora-sand">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
              activeTab === key
                ? 'border-ora-gold text-ora-charcoal font-medium'
                : 'border-transparent text-ora-muted hover:text-ora-charcoal-light'
            }`}
          >
            <Icon className="h-3.5 w-3.5 stroke-1" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'general' && <GeneralSettingsTab />}
      {activeTab === 'approval' && <ContentApprovalTab />}
      {activeTab === 'ai' && <AISettingsTab />}
      {activeTab === 'email' && <EmailTestTab />}
    </div>
  );
}


// ── General Settings Tab ─────────────────────────────────────────────────────

function GeneralSettingsTab() {
  const { data: settings, isLoading } = useSiteSettings();
  const updateSettings = useUpdateSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      const map: Record<string, string> = {};
      for (const entry of settings) {
        map[entry.key] = entry.value;
      }
      setValues(map);
    }
  }, [settings]);

  const handleSave = async () => {
    setSaved(false);
    try {
      await updateSettings.mutateAsync(values);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // error handled by mutation state
    }
  };

  if (isLoading) {
    return <ListSkeleton rows={4} />;
  }

  return (
    <div>
      <div className="space-y-4">
        {SETTING_KEYS.map(({ key, label }) => (
          <div key={key} className="border border-ora-sand/60 bg-ora-white p-4">
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
              {label}
            </label>
            <input
              type="text"
              value={values[key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
              placeholder={label}
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ora-charcoal mb-4">Navigation</h2>
        <div className="space-y-4">
          {NAV_SETTING_KEYS.map(({ key, label }) => (
            <div key={key} className="border border-ora-sand/60 bg-ora-white p-4">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                {label}
              </label>
              <input
                type="text"
                value={values[key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={label}
                className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold text-ora-charcoal mb-4">URLs</h2>
        <div className="space-y-4">
          {URL_SETTING_KEYS.map(({ key, label, placeholder, hint }) => (
            <div key={key} className="border border-ora-sand/60 bg-ora-white p-4">
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                {label}
              </label>
              <input
                type="text"
                value={values[key] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
              />
              {hint && (
                <p className="mt-1 text-[11px] text-ora-muted">{hint}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        {updateSettings.isError && (
          <span className="text-sm text-ora-error">Failed to save settings.</span>
        )}
        <button
          onClick={handleSave}
          disabled={updateSettings.isPending}
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4 stroke-1" />
          {updateSettings.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  );
}


// ── Content Approval Tab ─────────────────────────────────────────────────────

interface ModuleLocalState {
  enabled: boolean;
  orderedApprovers: { userId: string; position: number }[];
}

function ContentApprovalTab() {
  const { data: configs, isLoading: configLoading } = useApprovalConfig();
  const { data: users, isLoading: usersLoading } = useUsers();
  const updateConfig = useUpdateApprovalConfig();

  const [localState, setLocalState] = useState<Record<ContentModule, ModuleLocalState>>({
    pages: { enabled: false, orderedApprovers: [] },
    blog: { enabled: false, orderedApprovers: [] },
    news: { enabled: false, orderedApprovers: [] },
    construction_updates: { enabled: false, orderedApprovers: [] },
  });
  const [moduleStatus, setModuleStatus] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (configs && !initialized) {
      const next = { ...localState };
      for (const config of configs) {
        const mod = config.contentModule as ContentModule;
        next[mod] = {
          enabled: config.enabled,
          orderedApprovers: config.approvers
            .sort((a, b) => a.position - b.position)
            .map((a) => ({ userId: a.userId, position: a.position })),
        };
      }
      setLocalState(next);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs, initialized]);

  const handleToggle = useCallback((mod: ContentModule) => {
    setLocalState((prev) => ({
      ...prev,
      [mod]: { ...prev[mod], enabled: !prev[mod].enabled },
    }));
  }, []);

  const handleApproversChange = useCallback((mod: ContentModule, approvers: { userId: string; position: number }[]) => {
    setLocalState((prev) => ({
      ...prev,
      [mod]: { ...prev[mod], orderedApprovers: approvers },
    }));
  }, []);

  const handleSaveModule = async (mod: ContentModule) => {
    const state = localState[mod];
    setModuleStatus((prev) => ({ ...prev, [mod]: 'saving' }));
    try {
      await updateConfig.mutateAsync({
        module: mod,
        enabled: state.enabled,
        approvers: state.orderedApprovers,
      });
      setModuleStatus((prev) => ({ ...prev, [mod]: 'saved' }));
      setTimeout(() => setModuleStatus((prev) => ({ ...prev, [mod]: 'idle' })), 2000);
    } catch {
      setModuleStatus((prev) => ({ ...prev, [mod]: 'error' }));
    }
  };

  const isLoading = configLoading || usersLoading;

  if (isLoading) {
    return <ListSkeleton rows={4} rowClassName="h-24" />;
  }

  return (
    <div>
      <p className="text-sm text-ora-charcoal-light mb-4">
        Require approver sign-off before content goes live
      </p>

      <div className="space-y-4">
        {CONTENT_MODULES.map(({ key, label }) => {
          const state = localState[key];
          const status = moduleStatus[key] ?? 'idle';
          return (
            <div key={key} className="border border-ora-sand/60 bg-ora-white p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="text-sm font-medium text-ora-charcoal">{label}</span>
                  <span className="ml-2 text-xs text-ora-muted">
                    {state.enabled ? 'Approval required' : 'Direct publish'}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={state.enabled}
                  aria-label={`Toggle approval for ${label}`}
                  onClick={() => handleToggle(key)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    state.enabled ? 'bg-ora-gold' : 'bg-ora-sand'
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-ora-white transition-transform ${
                      state.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                    }`}
                  />
                </button>
              </div>

              {state.enabled && (
                <div className="mt-3">
                  <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                    Approval Chain
                  </label>
                  <OrderedApproverList
                    users={users ?? []}
                    orderedApprovers={state.orderedApprovers}
                    onChange={(approvers) => handleApproversChange(key, approvers)}
                  />
                </div>
              )}

              <div className="mt-3 flex items-center justify-end gap-2">
                {status === 'error' && (
                  <span className="text-xs text-ora-error">Failed to save</span>
                )}
                <button
                  onClick={() => handleSaveModule(key)}
                  disabled={status === 'saving'}
                  className="inline-flex h-9 items-center gap-2 bg-ora-charcoal px-5 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5 stroke-1" />
                  {status === 'saving'
                    ? 'Saving…'
                    : status === 'saved'
                      ? 'Saved!'
                      : 'Save'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── AI Settings Tab ──────────────────────────────────────────────────────────

function AISettingsTab() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ['ai-config'],
    queryFn: () => fetch('/api/ai/config').then((r) => r.json()),
  });

  const [languageModel, setLanguageModel] = useState('');
  const [embeddingModel, setEmbeddingModel] = useState('');
  const [topK, setTopK] = useState('5');
  const [relevanceThreshold, setRelevanceThreshold] = useState('0.7');
  const [conversationHistoryLength, setConversationHistoryLength] = useState('10');
  const [inactivityTimeout, setInactivityTimeout] = useState('30');
  const [welcomeMessageEn, setWelcomeMessageEn] = useState('');
  const [welcomeMessageAr, setWelcomeMessageAr] = useState('');
  const [permittedCategories, setPermittedCategories] = useState('');
  const [blockedKeywords, setBlockedKeywords] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!config) return;
    const c = config.config ?? config;
    setLanguageModel(c.languageModel ?? c.language_model ?? '');
    setEmbeddingModel(c.embeddingModel ?? c.embedding_model ?? '');
    setTopK(String(c.topK ?? c.top_k ?? 5));
    setRelevanceThreshold(String(c.relevanceThreshold ?? c.relevance_threshold ?? 0.7));
    setConversationHistoryLength(String(c.conversationHistoryLength ?? c.conversation_history_length ?? 10));
    setInactivityTimeout(String(c.inactivityTimeout ?? c.inactivity_timeout ?? 30));
    setWelcomeMessageEn(c.welcomeMessageEn ?? c.welcome_message_en ?? '');
    setWelcomeMessageAr(c.welcomeMessageAr ?? c.welcome_message_ar ?? '');
    setPermittedCategories(
      Array.isArray(c.permittedCategories ?? c.permitted_categories)
        ? (c.permittedCategories ?? c.permitted_categories).join(', ')
        : (c.permittedCategories ?? c.permitted_categories ?? '')
    );
    setBlockedKeywords(
      Array.isArray(c.blockedKeywords ?? c.blocked_keywords)
        ? (c.blockedKeywords ?? c.blocked_keywords).join(', ')
        : (c.blockedKeywords ?? c.blocked_keywords ?? '')
    );
  }, [config]);

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch('/api/ai/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => {
        if (!r.ok) throw new Error('Failed to save');
        return r.json();
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-config'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  const handleSave = () => {
    update.mutate({
      languageModel: languageModel.trim() || undefined,
      embeddingModel: embeddingModel.trim() || undefined,
      topK: Number(topK),
      relevanceThreshold: Number(relevanceThreshold),
      conversationHistoryLength: Number(conversationHistoryLength),
      inactivityTimeout: Number(inactivityTimeout),
      welcomeMessageEn: welcomeMessageEn.trim(),
      welcomeMessageAr: welcomeMessageAr.trim(),
      permittedCategories: permittedCategories.split(',').map((s) => s.trim()).filter(Boolean),
      blockedKeywords: blockedKeywords.split(',').map((s) => s.trim()).filter(Boolean),
    });
  };

  if (isLoading) {
    return <DetailFormSkeleton sections={2} fieldsPerSection={2} />;
  }

  return (
    <div className="space-y-6">
      {/* Model Configuration */}
      <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
        <h3 className="text-sm font-semibold text-ora-charcoal">Model Configuration</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Language Model</label>
            <input
              type="text"
              value={languageModel}
              onChange={(e) => setLanguageModel(e.target.value)}
              placeholder="e.g. @cf/meta/llama-3-8b-instruct"
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Embedding Model</label>
            <input
              type="text"
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              placeholder="e.g. @cf/baai/bge-base-en-v1.5"
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Retrieval Settings */}
      <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
        <h3 className="text-sm font-semibold text-ora-charcoal">Retrieval Settings</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Top-K Results</label>
            <input
              type="number"
              min="1"
              max="20"
              value={topK}
              onChange={(e) => setTopK(e.target.value)}
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Relevance Threshold (0–1)</label>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={relevanceThreshold}
              onChange={(e) => setRelevanceThreshold(e.target.value)}
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Conversation History Length</label>
            <input
              type="number"
              min="1"
              max="50"
              value={conversationHistoryLength}
              onChange={(e) => setConversationHistoryLength(e.target.value)}
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Inactivity Timeout (minutes)</label>
            <input
              type="number"
              min="1"
              value={inactivityTimeout}
              onChange={(e) => setInactivityTimeout(e.target.value)}
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Welcome Messages */}
      <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
        <h3 className="text-sm font-semibold text-ora-charcoal">Welcome Messages</h3>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Welcome Message (English)</label>
          <textarea
            value={welcomeMessageEn}
            onChange={(e) => setWelcomeMessageEn(e.target.value)}
            rows={3}
            placeholder="Hello! How can I help you today?"
            className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Welcome Message (Arabic)</label>
          <textarea
            value={welcomeMessageAr}
            onChange={(e) => setWelcomeMessageAr(e.target.value)}
            rows={3}
            dir="rtl"
            placeholder="مرحباً! كيف يمكنني مساعدتك اليوم؟"
            className="w-full border border-ora-stone bg-ora-white px-3 py-2 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none resize-y"
          />
        </div>
      </div>

      {/* Scope Configuration */}
      <div className="border border-ora-sand/60 bg-ora-white p-6 space-y-4">
        <h3 className="text-sm font-semibold text-ora-charcoal">Scope Configuration</h3>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Permitted Categories (comma-separated)</label>
          <input
            type="text"
            value={permittedCategories}
            onChange={(e) => setPermittedCategories(e.target.value)}
            placeholder="real_estate, payments, construction, community"
            className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Blocked Keywords (comma-separated)</label>
          <input
            type="text"
            value={blockedKeywords}
            onChange={(e) => setBlockedKeywords(e.target.value)}
            placeholder="competitor, lawsuit, internal"
            className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        {saved && <span className="text-sm text-ora-success">Settings saved</span>}
        {update.isError && <span className="text-sm text-ora-error">Failed to save settings.</span>}
        <button
          onClick={handleSave}
          disabled={update.isPending}
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5 stroke-1" />
          {update.isPending ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}


// ── Email Test Tab ───────────────────────────────────────────────────────────

interface EmailTestEnv {
  AZURE_COMMUNICATION_TENANT_ID: boolean;
  AZURE_COMMUNICATION_CLIENT_ID: boolean;
  AZURE_COMMUNICATION_CLIENT_SECRET: boolean;
  AZURE_COMMUNICATION_SENDER: string | null;
}

interface EmailTestResult {
  ok: boolean;
  message: string;
  env?: EmailTestEnv;
  details?: string;
  missing?: string[];
}

function EmailTestTab() {
  const [recipient, setRecipient] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [submitting, setSubmitting] = useState(false);
  const [env, setEnv] = useState<EmailTestEnv | null>(null);
  const [result, setResult] = useState<EmailTestResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/email-test', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.data?.env) setEnv(data.data.env as EmailTestEnv);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSend = async () => {
    if (!recipient) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/ai/email-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ recipient, language }),
      });
      const data = await res.json();
      if (res.ok && data?.data?.success) {
        setResult({
          ok: true,
          message: data.data.message ?? 'Email sent.',
          env: data.data.env,
        });
        if (data.data.env) setEnv(data.data.env as EmailTestEnv);
      } else {
        setResult({
          ok: false,
          message: data?.error ?? 'Email send failed.',
          details: data?.details,
          missing: data?.missing,
          env: data?.env,
        });
        if (data?.env) setEnv(data.env as EmailTestEnv);
      }
    } catch (err) {
      setResult({
        ok: false,
        message: 'Network error',
        details: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-ora-charcoal-light mb-4">
        Send a sample OTP email through Microsoft Graph to confirm Azure
        Communication credentials are working in this environment.
      </p>

      {env && (
        <div className="mb-4 border border-ora-sand/60 bg-ora-white p-4 text-sm">
          <p className="mb-2 text-xs font-medium text-ora-charcoal-light">
            Environment variables
          </p>
          <ul className="space-y-1 text-xs text-ora-charcoal">
            <li>
              <span className={env.AZURE_COMMUNICATION_TENANT_ID ? 'text-emerald-700' : 'text-ora-error'}>
                {env.AZURE_COMMUNICATION_TENANT_ID ? '✓' : '✗'}
              </span>{' '}
              AZURE_COMMUNICATION_TENANT_ID
            </li>
            <li>
              <span className={env.AZURE_COMMUNICATION_CLIENT_ID ? 'text-emerald-700' : 'text-ora-error'}>
                {env.AZURE_COMMUNICATION_CLIENT_ID ? '✓' : '✗'}
              </span>{' '}
              AZURE_COMMUNICATION_CLIENT_ID
            </li>
            <li>
              <span className={env.AZURE_COMMUNICATION_CLIENT_SECRET ? 'text-emerald-700' : 'text-ora-error'}>
                {env.AZURE_COMMUNICATION_CLIENT_SECRET ? '✓' : '✗'}
              </span>{' '}
              AZURE_COMMUNICATION_CLIENT_SECRET
            </li>
            <li>
              <span className={env.AZURE_COMMUNICATION_SENDER ? 'text-emerald-700' : 'text-ora-error'}>
                {env.AZURE_COMMUNICATION_SENDER ? '✓' : '✗'}
              </span>{' '}
              AZURE_COMMUNICATION_SENDER
              {env.AZURE_COMMUNICATION_SENDER ? (
                <span className="ml-2 text-ora-muted">({env.AZURE_COMMUNICATION_SENDER})</span>
              ) : null}
            </li>
          </ul>
        </div>
      )}

      <div className="border border-ora-sand/60 bg-ora-white p-4 space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
            Recipient email
          </label>
          <input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="someone@example.com"
            className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
            Template language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'en' | 'ar')}
            className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
          >
            <option value="en">English</option>
            <option value="ar">العربية</option>
          </select>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSend}
            disabled={!recipient || submitting}
            className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send test email'}
          </button>
        </div>

        {result && (
          <div
            className={`mt-3 border-l-4 p-3 text-sm ${
              result.ok
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                : 'border-ora-error bg-red-50 text-ora-error'
            }`}
          >
            <p className="font-medium">{result.message}</p>
            {result.missing && result.missing.length > 0 && (
              <p className="mt-1 text-xs">
                Missing: {result.missing.join(', ')}
              </p>
            )}
            {result.details && (
              <pre className="mt-2 wrap-break-word whitespace-pre-wrap text-[11px] opacity-80">
                {result.details}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
