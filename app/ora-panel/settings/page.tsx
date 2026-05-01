'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSiteSettings, useUpdateSettings } from '@/lib/cms/hooks';
import { useApprovalConfig, useUpdateApprovalConfig } from '@/lib/cms/hooks/use-approvals';
import { useUsers } from '@/lib/cms/hooks/use-users';
import { Save, X, ChevronDown } from 'lucide-react';
import type { ContentModule } from '@/lib/cms/types';

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

export default function SiteSettingsPage() {
  const { data: settings, isLoading } = useSiteSettings();
  const updateSettings = useUpdateSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  // Sync fetched settings into local state
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

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">Site Settings</h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">Global configuration values</p>
        </div>
        <button
          onClick={handleSave}
          disabled={updateSettings.isPending || isLoading}
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4 stroke-1" />
          {updateSettings.isPending ? 'Saving…' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded bg-ora-sand/60" />
          ))}
        </div>
      ) : (
        <>
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
            <h2 className="text-xl font-semibold text-ora-charcoal mb-4">Navigation</h2>
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
            <h2 className="text-xl font-semibold text-ora-charcoal mb-4">URLs</h2>
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
        </>
      )}

      {updateSettings.isError && (
        <p className="mt-4 text-sm text-ora-error">Failed to save settings. Please try again.</p>
      )}

      {/* AI Email Connection Test */}
      <AiEmailTestSection />

      {/* Content Approval Section */}
      <ContentApprovalSection />
    </div>
  );
}


// ── AI Email Connection Test ─────────────────────────────────────────────────

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

function AiEmailTestSection() {
  const [recipient, setRecipient] = useState('');
  const [language, setLanguage] = useState<'en' | 'ar'>('en');
  const [submitting, setSubmitting] = useState(false);
  const [env, setEnv] = useState<EmailTestEnv | null>(null);
  const [result, setResult] = useState<EmailTestResult | null>(null);

  // Fetch env presence on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/email-test', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.data?.env) setEnv(data.data.env as EmailTestEnv);
      })
      .catch(() => {
        // Ignore — UI will still render and surface errors when test runs
      });
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
    <div className="mt-8">
      <h2 className="text-xl font-semibold text-ora-charcoal mb-1">
        AI Email Connection
      </h2>
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


// ── Content Approval Section ─────────────────────────────────────────────────

interface ModuleLocalState {
  enabled: boolean;
  approverIds: string[];
}

function ContentApprovalSection() {
  const { data: configs, isLoading: configLoading } = useApprovalConfig();
  const { data: users, isLoading: usersLoading } = useUsers();
  const updateConfig = useUpdateApprovalConfig();

  const [localState, setLocalState] = useState<Record<ContentModule, ModuleLocalState>>({
    pages: { enabled: false, approverIds: [] },
    blog: { enabled: false, approverIds: [] },
    news: { enabled: false, approverIds: [] },
    construction_updates: { enabled: false, approverIds: [] },
  });
  const [savedModules, setSavedModules] = useState<Record<string, boolean>>({});
  const [initialized, setInitialized] = useState(false);

  // Sync server config into local state once loaded
  useEffect(() => {
    if (configs && !initialized) {
      const next = { ...localState };
      for (const config of configs) {
        const mod = config.contentModule as ContentModule;
        next[mod] = {
          enabled: config.enabled,
          approverIds: config.approvers.map((a) => a.userId),
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

  const handleApproversChange = useCallback((mod: ContentModule, ids: string[]) => {
    setLocalState((prev) => ({
      ...prev,
      [mod]: { ...prev[mod], approverIds: ids },
    }));
  }, []);

  const handleSaveModule = async (mod: ContentModule) => {
    const state = localState[mod];
    try {
      await updateConfig.mutateAsync({
        module: mod,
        enabled: state.enabled,
        approverIds: state.approverIds,
      });
      setSavedModules((prev) => ({ ...prev, [mod]: true }));
      setTimeout(() => setSavedModules((prev) => ({ ...prev, [mod]: false })), 2000);
    } catch {
      // error handled by mutation state
    }
  };

  const isLoading = configLoading || usersLoading;

  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold text-ora-charcoal mb-1">Content Approval</h2>
      <p className="text-sm text-ora-charcoal-light mb-4">
        Require approver sign-off before content goes live
      </p>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded bg-ora-sand/60" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {CONTENT_MODULES.map(({ key, label }) => {
            const state = localState[key];
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
                      Approvers
                    </label>
                    <ApproverPicker
                      users={users ?? []}
                      selectedIds={state.approverIds}
                      onChange={(ids) => handleApproversChange(key, ids)}
                    />
                  </div>
                )}

                <div className="mt-3 flex items-center justify-end gap-2">
                  {updateConfig.isError && (
                    <span className="text-xs text-ora-error">Failed to save</span>
                  )}
                  <button
                    onClick={() => handleSaveModule(key)}
                    disabled={updateConfig.isPending}
                    className="inline-flex h-9 items-center gap-2 bg-ora-charcoal px-5 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
                  >
                    <Save className="h-3.5 w-3.5 stroke-1" />
                    {updateConfig.isPending
                      ? 'Saving…'
                      : savedModules[key]
                        ? 'Saved!'
                        : 'Save'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Approver Picker (multi-select dropdown) ──────────────────────────────────

interface ApproverPickerProps {
  users: { id: string; name: string; email: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function ApproverPicker({ users, selectedIds, onChange }: ApproverPickerProps) {
  const [open, setOpen] = useState(false);

  const selectedUsers = users.filter((u) => selectedIds.includes(u.id));
  const availableUsers = users.filter((u) => !selectedIds.includes(u.id));

  const addUser = (id: string) => {
    onChange([...selectedIds, id]);
  };

  const removeUser = (id: string) => {
    onChange(selectedIds.filter((sid) => sid !== id));
  };

  return (
    <div className="relative">
      {/* Selected approvers as tags */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedUsers.map((user) => (
            <span
              key={user.id}
              className="inline-flex items-center gap-1 bg-ora-cream border border-ora-sand px-2 py-0.5 text-xs text-ora-charcoal"
            >
              {user.name}
              <button
                type="button"
                onClick={() => removeUser(user.id)}
                aria-label={`Remove ${user.name}`}
                className="text-ora-muted hover:text-ora-charcoal"
              >
                <X className="h-3 w-3 stroke-1" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center justify-between border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal hover:border-ora-gold transition-colors focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
      >
        <span className={selectedIds.length === 0 ? 'text-ora-muted' : 'text-ora-charcoal'}>
          {selectedIds.length === 0
            ? 'Select approvers…'
            : `${selectedIds.length} approver${selectedIds.length > 1 ? 's' : ''} selected`}
        </span>
        <ChevronDown className={`h-4 w-4 stroke-1 text-ora-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown list */}
      {open && (
        <div className="absolute z-10 mt-1 w-full border border-ora-sand bg-ora-white shadow-ora-md max-h-48 overflow-y-auto">
          {availableUsers.length === 0 ? (
            <div className="px-4 py-3 text-xs text-ora-muted">
              {users.length === 0 ? 'No users found' : 'All users selected'}
            </div>
          ) : (
            availableUsers.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => addUser(user.id)}
                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ora-charcoal hover:bg-ora-cream-light transition-colors"
              >
                <span className="font-medium">{user.name}</span>
                <span className="text-xs text-ora-muted">{user.email}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
