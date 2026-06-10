'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Save,
  Network,
  ExternalLink,
  Plus,
  Trash2,
  RefreshCw,
  FileText,
} from 'lucide-react';
import {
  useSitemapManager,
  useUpdateSitemapConfig,
  useRobotsTxt,
  useUpdateRobotsTxt,
  type SitemapCandidate,
} from '@/lib/cms/hooks/use-sitemap';
import { useSiteSettings } from '@/lib/cms/hooks';
import {
  CHANGE_FREQUENCIES,
  defaultRobotsTxt,
  type CustomSitemapLink,
  type SitemapChangeFrequency,
  type SitemapConfig,
  type SitemapEntryType,
  type SitemapLanguage,
} from '@/lib/cms/sitemap/config';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/$/, '');

const TABS = [
  { key: 'sitemap', label: 'Sitemap', icon: Network },
  { key: 'robots', label: 'Robots.txt', icon: FileText },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const TYPE_SECTIONS: {
  type: SitemapEntryType;
  title: string;
  includeKey: keyof Pick<
    SitemapConfig,
    'includePages' | 'includePosts' | 'includeProjects' | 'includeCommunities'
  >;
  description: string;
}[] = [
  { type: 'page', title: 'Pages', includeKey: 'includePages', description: 'Published CMS pages.' },
  { type: 'post', title: 'Blog / News', includeKey: 'includePosts', description: 'Published blog and news posts.' },
  { type: 'project', title: 'Projects', includeKey: 'includeProjects', description: 'Non-archived project landing pages.' },
  { type: 'community', title: 'Communities', includeKey: 'includeCommunities', description: 'Non-archived community landing pages.' },
];

export default function SitemapManagerPage() {
  const [tab, setTab] = useState<TabKey>('sitemap');

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-ora-charcoal">
          <Network className="h-5 w-5 stroke-1" /> Sitemap &amp; Robots
        </h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          Control what appears in <code>/sitemap.xml</code>, add custom links,
          and edit <code>/robots.txt</code>.
        </p>
      </div>

      <div className="mb-6 flex gap-1 border-b border-ora-sand">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm transition-colors ${
              tab === key
                ? 'border-ora-gold font-medium text-ora-charcoal'
                : 'border-transparent text-ora-muted hover:text-ora-charcoal-light'
            }`}
          >
            <Icon className="h-3.5 w-3.5 stroke-1" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'sitemap' ? <SitemapTab /> : <RobotsTab />}
    </div>
  );
}

// ── Sitemap tab ──────────────────────────────────────────────────────────────

function SitemapTab() {
  const { data, isLoading } = useSitemapManager();
  const { data: settings } = useSiteSettings();
  const updateConfig = useUpdateSitemapConfig();

  const [config, setConfig] = useState<SitemapConfig | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data?.config) setConfig(data.config);
  }, [data?.config]);

  const settingsMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const entry of settings ?? []) map[entry.key] = entry.value;
    return map;
  }, [settings]);

  const excludedSet = useMemo(
    () => new Set(config?.excludedKeys ?? []),
    [config?.excludedKeys]
  );

  function setFlag<K extends keyof SitemapConfig>(key: K, value: SitemapConfig[K]) {
    setConfig((c) => (c ? { ...c, [key]: value } : c));
  }

  function toggleExcluded(key: string) {
    setConfig((c) => {
      if (!c) return c;
      const next = new Set(c.excludedKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...c, excludedKeys: Array.from(next) };
    });
  }

  function addCustomLink() {
    setConfig((c) => {
      if (!c) return c;
      const link: CustomSitemapLink = {
        id: `custom-${Math.random().toString(36).slice(2, 10)}`,
        url: '',
        external: false,
        priority: 0.5,
        changeFrequency: 'weekly',
        lastModified: new Date().toISOString().slice(0, 10),
        language: 'en',
      };
      return { ...c, customLinks: [...c.customLinks, link] };
    });
  }

  function updateCustomLink(id: string, patch: Partial<CustomSitemapLink>) {
    setConfig((c) =>
      c
        ? {
            ...c,
            customLinks: c.customLinks.map((l) =>
              l.id === id ? { ...l, ...patch } : l
            ),
          }
        : c
    );
  }

  function removeCustomLink(id: string) {
    setConfig((c) =>
      c ? { ...c, customLinks: c.customLinks.filter((l) => l.id !== id) } : c
    );
  }

  async function handleSave() {
    if (!config) return;
    setSaved(false);
    try {
      await updateConfig.mutateAsync(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // surfaced via mutation state
    }
  }

  function previewUrl(type: SitemapEntryType, slug: string): string {
    const base = SITE_URL || '';
    switch (type) {
      case 'page':
        return `${base}/${slug}`;
      case 'post':
        return `${base}/blog/${slug}`;
      case 'project':
        return `${base}/${(settingsMap.project_slug_prefix || 'projects').trim()}/${slug}`;
      case 'community':
        return `${base}/${(settingsMap.community_slug_prefix || 'communities').trim()}/${slug}`;
    }
  }

  if (isLoading || !config) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded bg-ora-sand/60" />
        ))}
      </div>
    );
  }

  const candidates = data?.candidates;

  return (
    <div>
      <div className="mb-6 flex justify-end">
        <GenerateSitemapButton />
      </div>

      {/* Languages */}
      <section className="mb-6 border border-ora-sand/60 bg-ora-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ora-charcoal">Languages</h2>
        <ToggleRow
          label="Include Arabic URLs"
          hint="Emit /ar/… URLs and hreflang alternates. Turn off for an English-only sitemap."
          checked={config.includeArabic}
          onChange={(v) => setFlag('includeArabic', v)}
        />
      </section>

      {/* Content type sections */}
      <div className="space-y-6">
        {TYPE_SECTIONS.map((section) => {
          const items = candidates?.[section.type] ?? [];
          const enabled = config[section.includeKey];
          return (
            <section key={section.type} className="border border-ora-sand/60 bg-ora-white">
              <div className="flex items-center justify-between border-b border-ora-sand/60 p-4">
                <div>
                  <h2 className="text-sm font-semibold text-ora-charcoal">
                    {section.title}
                    <span className="ml-2 text-xs font-normal text-ora-muted">
                      {items.length} {items.length === 1 ? 'URL' : 'URLs'}
                    </span>
                  </h2>
                  <p className="mt-0.5 text-xs text-ora-muted">{section.description}</p>
                </div>
                <Switch
                  ariaLabel={`Include ${section.title} in sitemap`}
                  checked={enabled}
                  onChange={(v) => setFlag(section.includeKey, v)}
                />
              </div>

              {enabled && (
                <ul className="divide-y divide-ora-sand/40">
                  {items.length === 0 ? (
                    <li className="p-4 text-sm text-ora-muted">No published items.</li>
                  ) : (
                    items.map((item) => (
                      <EntryRow
                        key={item.key}
                        item={item}
                        included={!excludedSet.has(item.key)}
                        url={previewUrl(item.type, item.slug)}
                        onToggle={() => toggleExcluded(item.key)}
                      />
                    ))
                  )}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {/* Custom arbitrary links */}
      <section className="mt-6 border border-ora-sand/60 bg-ora-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-ora-charcoal">
          Custom Arbitrary Links
        </h2>
        <p className="mb-4 text-xs text-ora-muted">
          Extra URLs appended to the sitemap. Internal links are prefixed with
          the site URL (and /ar for Arabic); external links are used as-is.
        </p>

        {config.customLinks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ora-muted">
                <tr>
                  <th className="px-2 py-2 font-medium">URL</th>
                  <th className="px-2 py-2 font-medium">External</th>
                  <th className="px-2 py-2 font-medium">Priority</th>
                  <th className="px-2 py-2 font-medium">Change Frequency</th>
                  <th className="px-2 py-2 font-medium">Last Modified</th>
                  <th className="px-2 py-2 font-medium">Language</th>
                  <th className="px-2 py-2 font-medium text-right">Operations</th>
                </tr>
              </thead>
              <tbody>
                {config.customLinks.map((link) => (
                  <tr key={link.id} className="border-t border-ora-sand/50">
                    <td className="px-2 py-2">
                      <input
                        value={link.url}
                        onChange={(e) => updateCustomLink(link.id, { url: e.target.value })}
                        placeholder={link.external ? 'https://…' : '/about'}
                        className="h-9 w-40 border border-ora-sand bg-ora-white px-2 text-sm"
                      />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={link.external}
                        onChange={(e) => updateCustomLink(link.id, { external: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={String(link.priority)}
                        onChange={(e) => updateCustomLink(link.id, { priority: Number(e.target.value) })}
                        className="h-9 border border-ora-sand bg-ora-white px-2 text-sm"
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>
                            {p.toFixed(1)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={link.changeFrequency}
                        onChange={(e) =>
                          updateCustomLink(link.id, {
                            changeFrequency: e.target.value as SitemapChangeFrequency,
                          })
                        }
                        className="h-9 border border-ora-sand bg-ora-white px-2 text-sm"
                      >
                        {CHANGE_FREQUENCIES.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="date"
                        value={link.lastModified ? link.lastModified.slice(0, 10) : ''}
                        onChange={(e) => updateCustomLink(link.id, { lastModified: e.target.value })}
                        className="h-9 border border-ora-sand bg-ora-white px-2 text-sm"
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        value={link.language}
                        onChange={(e) =>
                          updateCustomLink(link.id, {
                            language: e.target.value as SitemapLanguage,
                          })
                        }
                        className="h-9 border border-ora-sand bg-ora-white px-2 text-sm"
                      >
                        <option value="en">English</option>
                        <option value="ar">Arabic</option>
                      </select>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeCustomLink(link.id)}
                        className="inline-flex h-9 items-center gap-1 border border-ora-sand bg-ora-white px-3 text-xs text-ora-error hover:bg-ora-cream"
                      >
                        <Trash2 className="h-3 w-3 stroke-1" /> Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <button
          type="button"
          onClick={addCustomLink}
          className="mt-4 inline-flex h-9 items-center gap-2 border border-ora-charcoal bg-ora-white px-4 text-sm text-ora-charcoal hover:bg-ora-cream"
        >
          <Plus className="h-3.5 w-3.5 stroke-1" /> Add new link
        </button>
      </section>

      {/* Save bar */}
      <div className="mt-6 flex items-center gap-3">
        {updateConfig.isError && (
          <span className="text-sm text-ora-error">Failed to save.</span>
        )}
        {saved && <span className="text-sm text-ora-success">Saved.</span>}
        <button
          onClick={handleSave}
          disabled={updateConfig.isPending}
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4 stroke-1" />
          {updateConfig.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

const PRIORITY_OPTIONS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

// ── Generate / preview button ───────────────────────────────────────────────

function GenerateSitemapButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [count, setCount] = useState<number | null>(null);

  async function regenerate() {
    setStatus('loading');
    setCount(null);
    try {
      // Sitemap is force-dynamic, so a fresh fetch reflects the saved config.
      const res = await fetch(`/sitemap.xml?ts=${Date.now()}`, { cache: 'no-store' });
      const xml = await res.text();
      const urls = (xml.match(/<url>/g) || []).length;
      setCount(urls);
      setStatus('done');
      setTimeout(() => setStatus('idle'), 4000);
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="flex items-center gap-3">
      {status === 'done' && count !== null && (
        <span className="text-sm text-ora-success">
          Generated {count} {count === 1 ? 'URL' : 'URLs'}
        </span>
      )}
      {status === 'error' && (
        <span className="text-sm text-ora-error">Failed to generate.</span>
      )}
      <a
        href="/sitemap.xml"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center gap-1.5 border border-ora-sand bg-ora-white px-4 text-sm text-ora-charcoal hover:bg-ora-cream"
      >
        <ExternalLink className="h-3.5 w-3.5 stroke-1" /> View
      </a>
      <button
        type="button"
        onClick={regenerate}
        disabled={status === 'loading'}
        className="inline-flex h-9 items-center gap-2 bg-ora-charcoal px-4 text-sm text-ora-white hover:bg-ora-graphite disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 stroke-1 ${status === 'loading' ? 'animate-spin' : ''}`} />
        {status === 'loading' ? 'Generating…' : 'Generate / Refresh'}
      </button>
    </div>
  );
}

// ── Robots.txt tab ───────────────────────────────────────────────────────────

function RobotsTab() {
  const { data: stored, isLoading } = useRobotsTxt();
  const updateRobots = useUpdateRobotsTxt();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fallback = useMemo(() => defaultRobotsTxt(SITE_URL), []);

  useEffect(() => {
    if (stored !== undefined) {
      setText(stored && stored.length > 0 ? stored : fallback);
    }
  }, [stored, fallback]);

  async function handleSave() {
    if (text === null) return;
    setSaved(false);
    try {
      await updateRobots.mutateAsync(text);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      // surfaced via mutation state
    }
  }

  if (isLoading || text === null) {
    return <div className="h-64 animate-pulse rounded bg-ora-sand/60" />;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-ora-charcoal-light">
          This exact text is served at <code>/robots.txt</code>.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setText(fallback)}
            className="inline-flex h-9 items-center gap-1.5 border border-ora-sand bg-ora-white px-3 text-xs text-ora-charcoal hover:bg-ora-cream"
          >
            <RefreshCw className="h-3 w-3 stroke-1" /> Reset to default
          </button>
          <a
            href="/robots.txt"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 border border-ora-sand bg-ora-white px-3 text-xs text-ora-charcoal hover:bg-ora-cream"
          >
            <ExternalLink className="h-3 w-3 stroke-1" /> View live
          </a>
        </div>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        rows={18}
        className="w-full resize-y border border-ora-stone bg-ora-white p-3 font-mono text-sm text-ora-charcoal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
      />

      <div className="mt-4 flex items-center gap-3">
        {updateRobots.isError && (
          <span className="text-sm text-ora-error">Failed to save.</span>
        )}
        {saved && <span className="text-sm text-ora-success">Saved.</span>}
        <button
          onClick={handleSave}
          disabled={updateRobots.isPending}
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4 stroke-1" />
          {updateRobots.isPending ? 'Saving…' : 'Save robots.txt'}
        </button>
      </div>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function EntryRow({
  item,
  included,
  url,
  onToggle,
}: {
  item: SitemapCandidate;
  included: boolean;
  url: string;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 p-3 pl-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-ora-charcoal">{item.label}</span>
          {item.noIndex && (
            <span className="shrink-0 border border-ora-error/40 bg-ora-error/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ora-error">
              noindex
            </span>
          )}
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="truncate text-xs text-ora-muted hover:text-ora-charcoal-light"
        >
          {url}
        </a>
      </div>
      <Switch
        ariaLabel={`Include ${item.label} in sitemap`}
        checked={included && !item.noIndex}
        disabled={item.noIndex}
        onChange={onToggle}
      />
    </li>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <span className="text-sm text-ora-charcoal">{label}</span>
        {hint && <p className="mt-0.5 text-xs text-ora-muted">{hint}</p>}
      </div>
      <Switch ariaLabel={label} checked={checked} onChange={onChange} />
    </div>
  );
}

function Switch({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-ora-gold' : 'bg-ora-sand'
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-ora-white transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  );
}
