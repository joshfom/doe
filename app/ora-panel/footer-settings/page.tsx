"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Languages,
  Layers,
  Link2,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Share2,
  Trash2,
} from "lucide-react";
import {
  useFooterConfig,
  useUpdateFooterConfig,
} from "@/lib/cms/hooks/use-footer-config";
import type {
  FooterConfig,
  FooterLink,
  FooterLinkGroup,
  FooterSection,
  FooterSocial,
  FooterTheme,
} from "@/lib/cms/types/footer-config";
import {
  DEFAULT_FOOTER_CONFIG_AR,
  DEFAULT_FOOTER_CONFIG_EN,
  DEFAULT_FOOTER_THEME,
} from "@/lib/cms/types/footer-config";

type Locale = "en" | "ar";

const SOCIAL_PLATFORMS = [
  "facebook",
  "instagram",
  "x",
  "twitter",
  "youtube",
  "linkedin",
] as const;

function ensureSectionShape(section: FooterSection): FooterSection {
  const hasGroups = Array.isArray(section.groups) && section.groups.length > 0;
  const hasLinks = Array.isArray(section.links) && section.links.length > 0;
  if (hasGroups || hasLinks) return section;
  return { ...section, links: [] };
}

function normalize(config: FooterConfig): FooterConfig {
  return {
    ...config,
    sections: config.sections.map(ensureSectionShape),
    legalLinks: config.legalLinks ?? [],
    showBrochureButton: config.showBrochureButton ?? true,
    brochureLabel: config.brochureLabel ?? "Download Brochure",
    brochureUrl: config.brochureUrl ?? "",
    theme: { ...DEFAULT_FOOTER_THEME, ...(config.theme || {}) },
  };
}

/* ──────────────────────────────────────────────────────────
 * Brand-styled primitives
 * ────────────────────────────────────────────────────────── */

function Card({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border border-ora-sand/60 bg-ora-white">
      <header className="flex items-center justify-between border-b border-ora-sand/60 px-6 py-4">
        <div className="flex items-center gap-2.5">
          {Icon ? (
            <Icon className="h-4 w-4 stroke-1 text-ora-charcoal-light" />
          ) : null}
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ora-charcoal">
            {title}
          </h2>
        </div>
        {action}
      </header>
      <div className="space-y-5 p-6">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-ora-charcoal-light">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] text-ora-charcoal-light/70">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

const inputClass =
  "w-full border border-ora-sand/60 bg-ora-white px-3 py-2 text-sm text-ora-charcoal outline-none transition-colors focus:border-ora-charcoal";

const selectClass = inputClass + " pr-8";

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

function PrimaryButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-2 bg-ora-charcoal px-4 py-2 text-xs font-medium uppercase tracking-[0.12em] text-ora-white transition-colors hover:bg-ora-graphite disabled:opacity-50 ${
        rest.className ?? ""
      }`}
    >
      {children}
    </button>
  );
}

function GhostButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 border border-ora-sand/70 bg-ora-white px-3 py-1.5 text-xs text-ora-charcoal-light transition-colors hover:border-ora-charcoal hover:text-ora-charcoal ${
        rest.className ?? ""
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  children,
  title,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      title={title}
      className={`inline-flex h-8 w-8 items-center justify-center text-ora-charcoal-light transition-colors hover:bg-ora-cream-light hover:text-ora-charcoal ${
        rest.className ?? ""
      }`}
    >
      {children}
    </button>
  );
}

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.1em] text-ora-charcoal-light">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer border border-ora-sand/60 bg-ora-white p-0.5"
          aria-label={`${label} color picker`}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} font-mono text-xs uppercase`}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

function LinkRow({
  link,
  onChange,
  onRemove,
}: {
  link: FooterLink;
  onChange: (updates: Partial<FooterLink>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-1 items-start gap-2 border border-ora-sand/60 bg-ora-cream-light/30 p-3 md:grid-cols-[1fr_1fr_120px_auto]">
      <input
        type="text"
        value={link.label}
        placeholder="Label"
        onChange={(e) => onChange({ label: e.target.value })}
        className={inputClass}
      />
      <input
        type="text"
        value={link.url}
        placeholder="/path or https://…"
        onChange={(e) => onChange({ url: e.target.value })}
        className={inputClass}
        spellCheck={false}
      />
      <select
        value={link.target ?? "_self"}
        onChange={(e) =>
          onChange({ target: e.target.value as "_self" | "_blank" })
        }
        className={selectClass}
      >
        <option value="_self">Same tab</option>
        <option value="_blank">New tab</option>
      </select>
      <IconButton title="Remove link" onClick={onRemove}>
        <Trash2 className="h-4 w-4 stroke-1" />
      </IconButton>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
 * Page
 * ────────────────────────────────────────────────────────── */

export default function FooterSettingsPage() {
  const [locale, setLocale] = useState<Locale>("en");
  const { data: footerConfig, isLoading } = useFooterConfig(locale);
  const updateMutation = useUpdateFooterConfig();

  const defaultForLocale = useMemo(
    () => (locale === "ar" ? DEFAULT_FOOTER_CONFIG_AR : DEFAULT_FOOTER_CONFIG_EN),
    [locale],
  );

  const [config, setConfig] = useState<FooterConfig>(
    normalize(defaultForLocale),
  );
  const [openSection, setOpenSection] = useState<number | null>(0);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (footerConfig) {
      setConfig(normalize(footerConfig));
    } else {
      setConfig(normalize(defaultForLocale));
    }
  }, [footerConfig, defaultForLocale]);

  async function handleSave() {
    setSaved(false);
    try {
      await updateMutation.mutateAsync({ locale, config });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch {
      /* handled by mutation state */
    }
  }

  function handleReset() {
    if (
      !window.confirm(
        "Reset this locale's footer to the default configuration? Unsaved changes will be lost.",
      )
    ) {
      return;
    }
    setConfig(normalize(defaultForLocale));
  }

  /* Sections ----------------------------------------- */
  function updateSection(i: number, updates: Partial<FooterSection>) {
    const next = [...config.sections];
    next[i] = { ...next[i], ...updates };
    setConfig({ ...config, sections: next });
  }
  function addSection() {
    setConfig({
      ...config,
      sections: [
        ...config.sections,
        { name: "New Section", links: [], columnSpan: 1 },
      ],
    });
    setOpenSection(config.sections.length);
  }
  function removeSection(i: number) {
    setConfig({
      ...config,
      sections: config.sections.filter((_, idx) => idx !== i),
    });
    if (openSection === i) setOpenSection(null);
  }

  /* Flat links --------------------------------------- */
  function addFlatLink(sIdx: number) {
    const next = [...config.sections];
    const s = ensureSectionShape(next[sIdx]);
    next[sIdx] = {
      ...s,
      groups: undefined,
      links: [...(s.links ?? []), { label: "New Link", url: "#", target: "_self" }],
    };
    setConfig({ ...config, sections: next });
  }
  function updateFlatLink(sIdx: number, lIdx: number, updates: Partial<FooterLink>) {
    const next = [...config.sections];
    const s = ensureSectionShape(next[sIdx]);
    const links = [...(s.links ?? [])];
    links[lIdx] = { ...links[lIdx], ...updates };
    next[sIdx] = { ...s, links };
    setConfig({ ...config, sections: next });
  }
  function removeFlatLink(sIdx: number, lIdx: number) {
    const next = [...config.sections];
    const s = ensureSectionShape(next[sIdx]);
    next[sIdx] = {
      ...s,
      links: (s.links ?? []).filter((_, i) => i !== lIdx),
    };
    setConfig({ ...config, sections: next });
  }

  /* Groups ------------------------------------------- */
  function enableGroups(sIdx: number) {
    const next = [...config.sections];
    next[sIdx] = {
      ...next[sIdx],
      links: undefined,
      groups: [{ name: "Group", links: [{ label: "Link", url: "#" }] }],
    };
    setConfig({ ...config, sections: next });
  }
  function disableGroups(sIdx: number) {
    const next = [...config.sections];
    next[sIdx] = { ...next[sIdx], groups: undefined, links: [] };
    setConfig({ ...config, sections: next });
  }
  function addGroup(sIdx: number) {
    const next = [...config.sections];
    const groups = [
      ...(next[sIdx].groups ?? []),
      { name: "Group", links: [{ label: "Link", url: "#" }] },
    ];
    next[sIdx] = { ...next[sIdx], groups, links: undefined };
    setConfig({ ...config, sections: next });
  }
  function updateGroup(sIdx: number, gIdx: number, updates: Partial<FooterLinkGroup>) {
    const next = [...config.sections];
    const groups = [...(next[sIdx].groups ?? [])];
    groups[gIdx] = { ...groups[gIdx], ...updates };
    next[sIdx] = { ...next[sIdx], groups };
    setConfig({ ...config, sections: next });
  }
  function removeGroup(sIdx: number, gIdx: number) {
    const next = [...config.sections];
    next[sIdx] = {
      ...next[sIdx],
      groups: (next[sIdx].groups ?? []).filter((_, i) => i !== gIdx),
    };
    setConfig({ ...config, sections: next });
  }
  function addGroupLink(sIdx: number, gIdx: number) {
    const next = [...config.sections];
    const groups = [...(next[sIdx].groups ?? [])];
    groups[gIdx] = {
      ...groups[gIdx],
      links: [...groups[gIdx].links, { label: "Link", url: "#", target: "_self" }],
    };
    next[sIdx] = { ...next[sIdx], groups };
    setConfig({ ...config, sections: next });
  }
  function updateGroupLink(
    sIdx: number,
    gIdx: number,
    lIdx: number,
    updates: Partial<FooterLink>,
  ) {
    const next = [...config.sections];
    const groups = [...(next[sIdx].groups ?? [])];
    const links = [...groups[gIdx].links];
    links[lIdx] = { ...links[lIdx], ...updates };
    groups[gIdx] = { ...groups[gIdx], links };
    next[sIdx] = { ...next[sIdx], groups };
    setConfig({ ...config, sections: next });
  }
  function removeGroupLink(sIdx: number, gIdx: number, lIdx: number) {
    const next = [...config.sections];
    const groups = [...(next[sIdx].groups ?? [])];
    groups[gIdx] = {
      ...groups[gIdx],
      links: groups[gIdx].links.filter((_, i) => i !== lIdx),
    };
    next[sIdx] = { ...next[sIdx], groups };
    setConfig({ ...config, sections: next });
  }

  /* Socials ------------------------------------------ */
  function addSocial() {
    setConfig({
      ...config,
      socials: [
        ...config.socials,
        { platform: "facebook", icon: "facebook", url: "#", target: "_blank" },
      ],
    });
  }
  function updateSocial(i: number, updates: Partial<FooterSocial>) {
    const next = [...config.socials];
    next[i] = { ...next[i], ...updates };
    setConfig({ ...config, socials: next });
  }
  function removeSocial(i: number) {
    setConfig({ ...config, socials: config.socials.filter((_, idx) => idx !== i) });
  }

  /* Legal links -------------------------------------- */
  function addLegalLink() {
    setConfig({
      ...config,
      legalLinks: [
        ...(config.legalLinks ?? []),
        { label: "Legal Link", url: "#", target: "_self" },
      ],
    });
  }
  function updateLegalLink(i: number, updates: Partial<FooterLink>) {
    const links = [...(config.legalLinks ?? [])];
    links[i] = { ...links[i], ...updates };
    setConfig({ ...config, legalLinks: links });
  }
  function removeLegalLink(i: number) {
    setConfig({
      ...config,
      legalLinks: (config.legalLinks ?? []).filter((_, idx) => idx !== i),
    });
  }

  /* Theme -------------------------------------------- */
  function updateTheme(updates: Partial<FooterTheme>) {
    setConfig({
      ...config,
      theme: { ...DEFAULT_FOOTER_THEME, ...(config.theme || {}), ...updates },
    });
  }
  function resetTheme() {
    setConfig({ ...config, theme: DEFAULT_FOOTER_THEME });
  }

  const theme = { ...DEFAULT_FOOTER_THEME, ...(config.theme || {}) };

  /* ──────────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ora-charcoal">
            Footer Settings
          </h1>
          <p className="mt-1 text-sm text-ora-charcoal-light">
            Control every element shown in the site footer — links, colors,
            social profiles, newsletter, and bottom bar.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 border border-ora-sand/60 bg-ora-white px-3 py-1.5 text-xs text-ora-charcoal-light">
            <Languages className="h-4 w-4 stroke-1" />
            {(["en", "ar"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={`px-2 py-0.5 text-xs font-medium uppercase tracking-wider transition-colors ${
                  locale === l
                    ? "bg-ora-charcoal text-ora-white"
                    : "text-ora-charcoal-light hover:text-ora-charcoal"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <GhostButton onClick={handleReset} title="Reset to defaults">
            <RotateCcw className="h-3.5 w-3.5 stroke-1" />
            Reset
          </GhostButton>
          <PrimaryButton onClick={handleSave} disabled={updateMutation.isPending}>
            <Save className="h-4 w-4 stroke-1" />
            {updateMutation.isPending
              ? "Saving…"
              : saved
                ? "Saved!"
                : "Save Changes"}
          </PrimaryButton>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse bg-ora-sand/40" />
          ))}
        </div>
      ) : (
        <>
          {/* ─── Appearance ─────────────────────────── */}
          <Card
            title="Appearance"
            icon={Palette}
            action={
              <GhostButton onClick={resetTheme}>
                <RotateCcw className="h-3.5 w-3.5 stroke-1" />
                Reset theme
              </GhostButton>
            }
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <ColorPicker
                label="Background"
                value={theme.background}
                onChange={(v) => updateTheme({ background: v })}
              />
              <ColorPicker
                label="Body text"
                value={theme.text}
                onChange={(v) => updateTheme({ text: v })}
              />
              <ColorPicker
                label="Accent (groups · labels · hover)"
                value={theme.accent}
                onChange={(v) =>
                  updateTheme({ accent: v, linkHover: v })
                }
              />
              <ColorPicker
                label="Section heading"
                value={theme.sectionHeading}
                onChange={(v) => updateTheme({ sectionHeading: v })}
              />
              <ColorPicker
                label="Dividers / border"
                value={theme.border}
                onChange={(v) => updateTheme({ border: v })}
              />
              <ColorPicker
                label="Link hover"
                value={theme.linkHover}
                onChange={(v) => updateTheme({ linkHover: v })}
              />
            </div>

            {/* Preview swatch */}
            <div
              className="mt-2 border p-4 text-xs"
              style={{
                background: theme.background,
                color: theme.text,
                borderColor: theme.border,
              }}
            >
              <div
                className="mb-2 text-xs font-medium uppercase tracking-[0.14em]"
                style={{ color: theme.sectionHeading }}
              >
                Section Heading
              </div>
              <div
                className="mb-1 text-xs font-medium uppercase tracking-[0.12em]"
                style={{ color: theme.accent }}
              >
                Group Label
              </div>
              <div className="text-sm" style={{ color: theme.text }}>
                Example footer link preview
              </div>
            </div>
          </Card>

          {/* ─── Sections ──────────────────────────── */}
          <Card
            title="Sections & Links"
            icon={Layers}
            action={
              <GhostButton onClick={addSection}>
                <Plus className="h-3.5 w-3.5 stroke-1" />
                Add section
              </GhostButton>
            }
          >
            <div className="space-y-3">
              {config.sections.map((section, sIdx) => {
                const isOpen = openSection === sIdx;
                const usesGroups =
                  section.groups && section.groups.length > 0;
                return (
                  <div
                    key={sIdx}
                    className="border border-ora-sand/60 bg-ora-cream-light/30"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenSection(isOpen ? null : sIdx)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-ora-cream-light"
                    >
                      <div className="flex items-center gap-2">
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4 stroke-1" />
                        ) : (
                          <ChevronRight className="h-4 w-4 stroke-1" />
                        )}
                        <span className="text-sm font-medium text-ora-charcoal">
                          {section.name || "Untitled section"}
                        </span>
                        <span className="ml-2 text-[11px] uppercase tracking-wider text-ora-charcoal-light">
                          {usesGroups
                            ? `${section.groups?.length ?? 0} groups`
                            : `${section.links?.length ?? 0} links`}
                          {" · span "}
                          {section.columnSpan ?? 1}
                        </span>
                      </div>
                    </button>

                    {isOpen ? (
                      <div className="space-y-4 border-t border-ora-sand/60 p-4">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_auto]">
                          <Field label="Section name">
                            <TextInput
                              value={section.name}
                              onChange={(e) =>
                                updateSection(sIdx, { name: e.target.value })
                              }
                            />
                          </Field>
                          <Field
                            label="Column span"
                            hint="How wide on desktop"
                          >
                            <select
                              value={section.columnSpan ?? 1}
                              onChange={(e) =>
                                updateSection(sIdx, {
                                  columnSpan: Number(e.target.value) as 1 | 2,
                                })
                              }
                              className={selectClass}
                            >
                              <option value={1}>1 column</option>
                              <option value={2}>2 columns (wide)</option>
                            </select>
                          </Field>
                          <div className="flex items-end justify-end">
                            <GhostButton
                              onClick={() => removeSection(sIdx)}
                              className="text-red-600 hover:border-red-600 hover:text-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5 stroke-1" />
                              Remove section
                            </GhostButton>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 border-t border-ora-sand/40 pt-4">
                          <span className="text-xs uppercase tracking-wider text-ora-charcoal-light">
                            Layout:
                          </span>
                          {!usesGroups ? (
                            <GhostButton onClick={() => enableGroups(sIdx)}>
                              Switch to grouped links
                            </GhostButton>
                          ) : (
                            <GhostButton onClick={() => disableGroups(sIdx)}>
                              Switch to flat list
                            </GhostButton>
                          )}
                        </div>

                        {usesGroups ? (
                          <div className="space-y-4">
                            {section.groups!.map((group, gIdx) => (
                              <div
                                key={gIdx}
                                className="border border-ora-sand/60 bg-ora-white p-3"
                              >
                                <div className="mb-3 flex items-center gap-2">
                                  <TextInput
                                    value={group.name ?? ""}
                                    placeholder="Group heading (e.g. EGYPT)"
                                    onChange={(e) =>
                                      updateGroup(sIdx, gIdx, {
                                        name: e.target.value,
                                      })
                                    }
                                  />
                                  <IconButton
                                    title="Remove group"
                                    onClick={() => removeGroup(sIdx, gIdx)}
                                  >
                                    <Trash2 className="h-4 w-4 stroke-1" />
                                  </IconButton>
                                </div>

                                <div className="space-y-2">
                                  {group.links.map((link, lIdx) => (
                                    <LinkRow
                                      key={lIdx}
                                      link={link}
                                      onChange={(u) =>
                                        updateGroupLink(sIdx, gIdx, lIdx, u)
                                      }
                                      onRemove={() =>
                                        removeGroupLink(sIdx, gIdx, lIdx)
                                      }
                                    />
                                  ))}
                                </div>
                                <GhostButton
                                  onClick={() => addGroupLink(sIdx, gIdx)}
                                  className="mt-3"
                                >
                                  <Plus className="h-3.5 w-3.5 stroke-1" />
                                  Add link
                                </GhostButton>
                              </div>
                            ))}
                            <GhostButton onClick={() => addGroup(sIdx)}>
                              <Plus className="h-3.5 w-3.5 stroke-1" />
                              Add group
                            </GhostButton>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(section.links ?? []).map((link, lIdx) => (
                              <LinkRow
                                key={lIdx}
                                link={link}
                                onChange={(u) => updateFlatLink(sIdx, lIdx, u)}
                                onRemove={() => removeFlatLink(sIdx, lIdx)}
                              />
                            ))}
                            <GhostButton onClick={() => addFlatLink(sIdx)}>
                              <Plus className="h-3.5 w-3.5 stroke-1" />
                              Add link
                            </GhostButton>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ─── Recruitment + Newsletter ─────────── */}
          <Card title="Recruitment & Newsletter" icon={Link2}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Recruitment heading">
                <TextInput
                  value={config.recruitment.text}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      recruitment: {
                        ...config.recruitment,
                        text: e.target.value,
                      },
                    })
                  }
                />
              </Field>
              <Field label="Recruitment email">
                <TextInput
                  type="email"
                  value={config.recruitment.email}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      recruitment: {
                        ...config.recruitment,
                        email: e.target.value,
                      },
                    })
                  }
                />
              </Field>
            </div>

            <div className="border-t border-ora-sand/40 pt-4">
              <label className="mb-3 flex items-center gap-2 text-sm text-ora-charcoal">
                <input
                  type="checkbox"
                  checked={config.newsletter.enabled}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      newsletter: {
                        ...config.newsletter,
                        enabled: e.target.checked,
                      },
                    })
                  }
                  className="h-4 w-4 accent-ora-charcoal"
                />
                Show newsletter subscribe form
              </label>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Newsletter heading">
                  <TextInput
                    value={config.newsletter.label}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        newsletter: {
                          ...config.newsletter,
                          label: e.target.value,
                        },
                      })
                    }
                    disabled={!config.newsletter.enabled}
                  />
                </Field>
                <Field label="Email input placeholder">
                  <TextInput
                    value={config.newsletter.placeholder}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        newsletter: {
                          ...config.newsletter,
                          placeholder: e.target.value,
                        },
                      })
                    }
                    disabled={!config.newsletter.enabled}
                  />
                </Field>
              </div>
            </div>
          </Card>

          {/* ─── Socials ─────────────────────────── */}
          <Card
            title="Social Links"
            icon={Share2}
            action={
              <GhostButton onClick={addSocial}>
                <Plus className="h-3.5 w-3.5 stroke-1" />
                Add social
              </GhostButton>
            }
          >
            <div className="space-y-2">
              {config.socials.map((social, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-1 items-start gap-2 border border-ora-sand/60 bg-ora-cream-light/30 p-3 md:grid-cols-[160px_1fr_120px_auto]"
                >
                  <select
                    value={social.platform}
                    onChange={(e) =>
                      updateSocial(idx, {
                        platform: e.target.value,
                        icon: e.target.value,
                      })
                    }
                    className={selectClass}
                  >
                    {SOCIAL_PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                    <option value={social.platform}>Custom: {social.platform}</option>
                  </select>
                  <TextInput
                    value={social.url}
                    placeholder="https://…"
                    onChange={(e) => updateSocial(idx, { url: e.target.value })}
                  />
                  <select
                    value={social.target ?? "_blank"}
                    onChange={(e) =>
                      updateSocial(idx, {
                        target: e.target.value as "_self" | "_blank",
                      })
                    }
                    className={selectClass}
                  >
                    <option value="_blank">New tab</option>
                    <option value="_self">Same tab</option>
                  </select>
                  <IconButton
                    title="Remove social"
                    onClick={() => removeSocial(idx)}
                  >
                    <Trash2 className="h-4 w-4 stroke-1" />
                  </IconButton>
                </div>
              ))}
            </div>
          </Card>

          {/* ─── Bottom bar ──────────────────────── */}
          <Card title="Bottom Bar" icon={Link2}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Copyright text">
                <TextInput
                  value={config.legal}
                  onChange={(e) =>
                    setConfig({ ...config, legal: e.target.value })
                  }
                />
              </Field>
              <Field label="Back-to-top aria label">
                <TextInput
                  value={config.backToTopLabel}
                  onChange={(e) =>
                    setConfig({ ...config, backToTopLabel: e.target.value })
                  }
                />
              </Field>
            </div>

            <div className="border-t border-ora-sand/40 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-[0.12em] text-ora-charcoal-light">
                  Legal links
                </h3>
                <GhostButton onClick={addLegalLink}>
                  <Plus className="h-3.5 w-3.5 stroke-1" />
                  Add legal link
                </GhostButton>
              </div>
              <div className="space-y-2">
                {(config.legalLinks ?? []).map((link, idx) => (
                  <LinkRow
                    key={idx}
                    link={link}
                    onChange={(u) => updateLegalLink(idx, u)}
                    onRemove={() => removeLegalLink(idx)}
                  />
                ))}
              </div>
            </div>

            <div className="border-t border-ora-sand/40 pt-4">
              <label className="mb-3 flex items-center gap-2 text-sm text-ora-charcoal">
                <input
                  type="checkbox"
                  checked={config.showBrochureButton !== false}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      showBrochureButton: e.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-ora-charcoal"
                />
                Show &quot;Download Brochure&quot; button
              </label>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Brochure button label">
                  <TextInput
                    value={config.brochureLabel ?? ""}
                    onChange={(e) =>
                      setConfig({ ...config, brochureLabel: e.target.value })
                    }
                    disabled={config.showBrochureButton === false}
                  />
                </Field>
                <Field label="Brochure file URL">
                  <TextInput
                    value={config.brochureUrl ?? ""}
                    placeholder="/files/brochure.pdf"
                    onChange={(e) =>
                      setConfig({ ...config, brochureUrl: e.target.value })
                    }
                    disabled={config.showBrochureButton === false}
                  />
                </Field>
              </div>
            </div>
          </Card>

          {/* Floating save bar on small screens */}
          <div className="flex justify-end pt-2">
            <PrimaryButton onClick={handleSave} disabled={updateMutation.isPending}>
              <Save className="h-4 w-4 stroke-1" />
              {updateMutation.isPending
                ? "Saving…"
                : saved
                  ? "Saved!"
                  : "Save Changes"}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}
