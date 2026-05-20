'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, Copy, Check, QrCode, Search, X, Download } from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Campaign name: lowercase alphanumeric, underscores, hyphens, max 128 chars
const CAMPAIGN_NAME_PATTERN = /^[a-z0-9_-]+$/;
const CAMPAIGN_NAME_MAX = 128;

// Source/medium presets for real estate developers
const SOURCE_PRESETS = [
  { label: "── Digital ──", value: "", disabled: true },
  { label: "Google", value: "google" },
  { label: "Facebook", value: "facebook" },
  { label: "Instagram", value: "instagram" },
  { label: "TikTok", value: "tiktok" },
  { label: "LinkedIn", value: "linkedin" },
  { label: "Snapchat", value: "snapchat" },
  { label: "YouTube", value: "youtube" },
  { label: "Bing", value: "bing" },
  { label: "── Offline / Events ──", value: "", disabled: true },
  { label: "Roadshow", value: "roadshow" },
  { label: "Open House", value: "open_house" },
  { label: "Broker Briefing", value: "broker_briefing" },
  { label: "Property Exhibition", value: "property_exhibition" },
  { label: "Print Flyer", value: "print_flyer" },
  { label: "Billboard", value: "billboard" },
  { label: "── Direct ──", value: "", disabled: true },
  { label: "SMS", value: "sms" },
  { label: "WhatsApp", value: "whatsapp" },
  { label: "Email Blast", value: "email_blast" },
  { label: "── Other ──", value: "", disabled: true },
  { label: "Referral", value: "referral" },
  { label: "QR Code", value: "qr_code" },
  { label: "Other", value: "other" },
];

const MEDIUM_PRESETS = [
  { label: "── Paid ──", value: "", disabled: true },
  { label: "CPC (Cost per Click)", value: "cpc" },
  { label: "Paid Social", value: "paid_social" },
  { label: "Display", value: "display" },
  { label: "Video", value: "video" },
  { label: "── Offline ──", value: "", disabled: true },
  { label: "Offline Event", value: "offline_event" },
  { label: "Outdoor", value: "outdoor" },
  { label: "Print", value: "print" },
  { label: "── Direct ──", value: "", disabled: true },
  { label: "Direct", value: "direct" },
  { label: "Email", value: "email" },
  { label: "── Organic ──", value: "", disabled: true },
  { label: "Organic Social", value: "organic_social" },
  { label: "Organic Search", value: "organic" },
  { label: "Referral", value: "referral" },
];

// ── Validation ───────────────────────────────────────────────────────────────

interface FormValues {
  destinationUrl: string;
  project: string;
  campaignName: string;
  source: string;
  medium: string;
  term: string;
  content: string;
}

interface ValidationErrors {
  [key: string]: string;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validateForm(values: FormValues): ValidationErrors {
  const errors: ValidationErrors = {};

  // Destination URL: required, must be valid
  if (!values.destinationUrl.trim()) {
    errors.destinationUrl = 'Destination URL is required';
  } else if (!isValidUrl(values.destinationUrl.trim())) {
    errors.destinationUrl = 'Must be a valid URL (http:// or https://)';
  }

  // Campaign name: required, pattern validation
  if (!values.campaignName.trim()) {
    errors.campaignName = 'Campaign name is required';
  } else if (values.campaignName.length > CAMPAIGN_NAME_MAX) {
    errors.campaignName = `Maximum ${CAMPAIGN_NAME_MAX} characters allowed`;
  } else if (!CAMPAIGN_NAME_PATTERN.test(values.campaignName)) {
    errors.campaignName =
      'Only lowercase alphanumeric characters, underscores, and hyphens allowed';
  }

  // Source: required
  if (!values.source.trim()) {
    errors.source = 'Source is required';
  }

  // Medium: required
  if (!values.medium.trim()) {
    errors.medium = 'Medium is required';
  }

  return errors;
}

// ── Build tagged URL ─────────────────────────────────────────────────────────

function buildTaggedUrl(values: FormValues): string {
  const url = new URL(values.destinationUrl.trim());
  url.searchParams.set('utm_source', values.source.trim());
  url.searchParams.set('utm_medium', values.medium.trim());
  url.searchParams.set('utm_campaign', values.campaignName.trim());
  if (values.term.trim()) {
    url.searchParams.set('utm_term', values.term.trim());
  }
  if (values.content.trim()) {
    url.searchParams.set('utm_content', values.content.trim());
  }
  return url.toString();
}

// ── QR Code Component ────────────────────────────────────────────────────────

function QRCodeDisplay({ url }: { url: string }) {
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    // Dynamic import to avoid SSR issues with the QR code generator
    import('@/lib/analytics/qr-code').then(({ generateQRCodeSVG }) => {
      setSvg(generateQRCodeSVG(url, 160));
    });
  }, [url]);

  if (!svg) {
    return (
      <div className="flex h-40 w-40 items-center justify-center bg-ora-sand/30">
        <QrCode className="h-8 w-8 text-ora-muted" />
      </div>
    );
  }

  return (
    <div
      className="inline-block border border-ora-sand/60 bg-white p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ── UTM Link History Item Type ───────────────────────────────────────────────

interface UtmLinkRecord {
  id: string;
  destinationUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmTerm: string | null;
  utmContent: string | null;
  taggedUrl: string;
  project: string | null;
  createdAt: string;
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function UtmBuilderPage() {
  const queryClient = useQueryClient();

  // Form state
  const [values, setValues] = useState<FormValues>({
    destinationUrl: '',
    project: '',
    campaignName: '',
    source: '',
    medium: '',
    term: '',
    content: '',
  });
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [generatedUrl, setGeneratedUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // History filters
  const [projectFilter, setProjectFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');

  // Fetch history
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['utm-links', projectFilter, campaignFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (projectFilter) params.set('project', projectFilter);
      if (campaignFilter) params.set('campaign', campaignFilter);
      const res = await fetch(
        `${API_BASE_URL}/api/utm-links?${params.toString()}`,
        { credentials: 'include' }
      );
      if (!res.ok) throw new Error('Failed to fetch UTM links');
      const json = await res.json();
      return json.data as UtmLinkRecord[];
    },
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (payload: {
      destinationUrl: string;
      utmSource: string;
      utmMedium: string;
      utmCampaign: string;
      utmTerm?: string;
      utmContent?: string;
      taggedUrl: string;
      project?: string;
    }) => {
      const res = await fetch(`${API_BASE_URL}/api/utm-links`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Failed to save UTM link');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['utm-links'] });
    },
  });

  const handleChange = (field: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleGenerate = useCallback(() => {
    const validationErrors = validateForm(values);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      setGeneratedUrl('');
      return;
    }

    const tagged = buildTaggedUrl(values);
    setGeneratedUrl(tagged);

    // Save to database
    saveMutation.mutate({
      destinationUrl: values.destinationUrl.trim(),
      utmSource: values.source.trim(),
      utmMedium: values.medium.trim(),
      utmCampaign: values.campaignName.trim(),
      utmTerm: values.term.trim() || undefined,
      utmContent: values.content.trim() || undefined,
      taggedUrl: tagged,
      project: values.project.trim() || undefined,
    });
  }, [values, saveMutation]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text in a temporary input
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">UTM Builder</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          Generate tagged URLs with consistent campaign naming for attribution tracking
        </p>
      </div>

      {/* UTM Form */}
      <div className="mb-8 border border-ora-sand/60 bg-ora-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">
          Build Tagged URL
        </h2>
        <div className="space-y-4">
          <Field
            label="Destination URL"
            hint="The landing page URL to tag"
            value={values.destinationUrl}
            onChange={(v) => handleChange('destinationUrl', v)}
            error={errors.destinationUrl}
            placeholder="https://example.com/landing-page"
            required
          />

          <Field
            label="Project"
            hint="Group links by project (e.g., marina, creek)"
            value={values.project}
            onChange={(v) => handleChange('project', v)}
            placeholder="marina"
          />

          <Field
            label="Campaign Name"
            hint="Pattern: {project}_{quarter}_{audience} — lowercase, underscores, hyphens only, max 128 chars"
            value={values.campaignName}
            onChange={(v) => handleChange('campaignName', v)}
            error={errors.campaignName}
            placeholder="marina_q1-2025_investors"
            required
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectWithCustom
              label="Source (utm_source)"
              hint="Where the traffic comes from"
              value={values.source}
              onChange={(v) => handleChange('source', v)}
              error={errors.source}
              options={SOURCE_PRESETS}
              placeholder="Select or type source"
              required
            />

            <SelectWithCustom
              label="Medium (utm_medium)"
              hint="Marketing channel type"
              value={values.medium}
              onChange={(v) => handleChange('medium', v)}
              error={errors.medium}
              options={MEDIUM_PRESETS}
              placeholder="Select or type medium"
              required
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Term (utm_term)"
              hint="Optional — keyword or targeting term"
              value={values.term}
              onChange={(v) => handleChange('term', v)}
              placeholder="luxury_apartments"
            />

            <Field
              label="Content (utm_content)"
              hint="Optional — ad creative or variant identifier"
              value={values.content}
              onChange={(v) => handleChange('content', v)}
              placeholder="hero_video_v2"
            />
          </div>

          {/* Generate Button */}
          <div className="pt-2">
            <button
              onClick={handleGenerate}
              disabled={saveMutation.isPending}
              className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
            >
              <Link2 className="h-4 w-4 stroke-1" />
              {saveMutation.isPending ? 'Generating…' : 'Generate Tagged URL'}
            </button>
          </div>
        </div>
      </div>

      {/* Generated URL Display */}
      {generatedUrl && (
        <div className="mb-8 border border-ora-sand/60 bg-ora-white p-6">
          <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">
            Generated URL
          </h2>
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <code className="block flex-1 break-all rounded bg-ora-sand/30 px-3 py-2 text-xs text-ora-charcoal">
                  {generatedUrl}
                </code>
                <button
                  onClick={handleCopy}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-ora-stone text-ora-charcoal hover:bg-ora-sand/30 transition-colors"
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
              </div>
              {copied && (
                <p className="mt-1 text-[11px] text-emerald-700">
                  Copied to clipboard
                </p>
              )}
            </div>
            <div className="shrink-0 flex flex-col items-center gap-2">
              <QRCodeDisplay url={generatedUrl} />
              <button
                onClick={() => downloadQRCode(generatedUrl)}
                className="inline-flex h-8 items-center gap-1.5 border border-ora-stone px-3 text-[11px] font-medium text-ora-charcoal hover:bg-ora-sand/30 transition-colors"
                title="Download QR code as PNG"
              >
                <Download className="h-3.5 w-3.5" />
                Download QR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Section */}
      <div className="border border-ora-sand/60 bg-ora-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">
          Link History
        </h2>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ora-muted" />
            <input
              type="text"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              placeholder="Filter by project…"
              className="h-9 w-full border border-ora-stone bg-ora-white pl-9 pr-8 text-xs text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
            {projectFilter && (
              <button
                onClick={() => setProjectFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ora-muted hover:text-ora-charcoal"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ora-muted" />
            <input
              type="text"
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              placeholder="Filter by campaign…"
              className="h-9 w-full border border-ora-stone bg-ora-white pl-9 pr-8 text-xs text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
            />
            {campaignFilter && (
              <button
                onClick={() => setCampaignFilter('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ora-muted hover:text-ora-charcoal"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* History Table */}
        {historyLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-ora-sand/40" />
            ))}
          </div>
        ) : !historyData?.length ? (
          <div className="py-8 text-center">
            <Link2 className="mx-auto mb-2 h-8 w-8 stroke-1 text-ora-muted" />
            <p className="text-sm text-ora-muted">No UTM links generated yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ora-sand/60 text-ora-charcoal-light">
                  <th className="pb-2 pr-3 font-medium">Campaign</th>
                  <th className="pb-2 pr-3 font-medium">Source / Medium</th>
                  <th className="pb-2 pr-3 font-medium">Project</th>
                  <th className="pb-2 pr-3 font-medium">URL</th>
                  <th className="pb-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {historyData.map((link) => (
                  <HistoryRow key={link.id} link={link} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── History Row ──────────────────────────────────────────────────────────────

function HistoryRow({ link }: { link: UtmLinkRecord }) {
  const [rowCopied, setRowCopied] = useState(false);

  const handleRowCopy = async () => {
    try {
      await navigator.clipboard.writeText(link.taggedUrl);
      setRowCopied(true);
      setTimeout(() => setRowCopied(false), 2000);
    } catch {
      // Silently fail
    }
  };

  return (
    <tr className="border-b border-ora-sand/30 last:border-0">
      <td className="py-2.5 pr-3 font-medium text-ora-charcoal">
        {link.utmCampaign}
      </td>
      <td className="py-2.5 pr-3 text-ora-charcoal-light">
        {link.utmSource} / {link.utmMedium}
      </td>
      <td className="py-2.5 pr-3 text-ora-charcoal-light">
        {link.project || '—'}
      </td>
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-1.5">
          <span
            className="max-w-[200px] truncate text-ora-charcoal-light"
            title={link.taggedUrl}
          >
            {link.taggedUrl}
          </span>
          <button
            onClick={handleRowCopy}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-ora-muted hover:text-ora-charcoal transition-colors"
            title="Copy URL"
          >
            {rowCopied ? (
              <Check className="h-3 w-3 text-emerald-600" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
      </td>
      <td className="py-2.5 text-ora-muted">
        {new Date(link.createdAt).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}
      </td>
    </tr>
  );
}

// ── Shared UI Components ─────────────────────────────────────────────────────

function Field({
  label,
  hint,
  value,
  onChange,
  error,
  placeholder,
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
        {label}
        {required && <span className="ml-1 text-ora-error">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-10 w-full border bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:outline-none ${
          error
            ? 'border-ora-error focus-visible:ring-ora-error'
            : 'border-ora-stone focus-visible:ring-ora-gold'
        }`}
      />
      {hint && !error && (
        <p className="mt-1 text-[11px] text-ora-muted">{hint}</p>
      )}
      {error && (
        <p className="mt-1 text-[11px] text-ora-error">{error}</p>
      )}
    </div>
  );
}

// ── Select with custom input ─────────────────────────────────────────────────

function SelectWithCustom({
  label,
  hint,
  value,
  onChange,
  error,
  options,
  placeholder,
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  options: Array<{ label: string; value: string; disabled?: boolean }>;
  placeholder?: string;
  required?: boolean;
}) {
  const [isCustom, setIsCustom] = useState(false);

  // Check if current value matches any preset
  const isPresetValue = options.some((o) => o.value === value && !o.disabled);

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
        {label}
        {required && <span className="ml-1 text-ora-error">*</span>}
      </label>
      {isCustom || (!isPresetValue && value) ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`h-10 flex-1 border bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:ring-1 focus-visible:outline-none ${
              error
                ? 'border-ora-error focus-visible:ring-ora-error'
                : 'border-ora-stone focus-visible:ring-ora-gold'
            }`}
          />
          <button
            type="button"
            onClick={() => { setIsCustom(false); onChange(''); }}
            className="h-10 shrink-0 border border-ora-stone px-3 text-[11px] text-ora-muted hover:text-ora-charcoal transition-colors"
            title="Switch to presets"
          >
            Presets
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <select
            value={value}
            onChange={(e) => {
              if (e.target.value === '__custom__') {
                setIsCustom(true);
                onChange('');
              } else {
                onChange(e.target.value);
              }
            }}
            className={`h-10 flex-1 border bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:outline-none ${
              error
                ? 'border-ora-error focus-visible:ring-ora-error'
                : 'border-ora-stone focus-visible:ring-ora-gold'
            }`}
          >
            <option value="">{placeholder || 'Select...'}</option>
            {options.map((opt, i) => (
              <option key={`${opt.value}-${i}`} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))}
            <option value="__custom__">✏️ Type custom value...</option>
          </select>
        </div>
      )}
      {hint && !error && (
        <p className="mt-1 text-[11px] text-ora-muted">{hint}</p>
      )}
      {error && (
        <p className="mt-1 text-[11px] text-ora-error">{error}</p>
      )}
    </div>
  );
}

// ── QR Code Download ─────────────────────────────────────────────────────────

/**
 * Downloads the QR code as a high-res PNG (300×300) suitable for print.
 * Creates an off-screen canvas, renders the SVG onto it, then triggers
 * a download.
 */
function downloadQRCode(url: string) {
  import('@/lib/analytics/qr-code').then(({ generateQRCodeSVG }) => {
    const svgString = generateQRCodeSVG(url, 300);
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      // White background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 300, 300);
      ctx.drawImage(img, 0, 0, 300, 300);

      // Trigger download
      const link = document.createElement('a');
      link.download = `qr-${url.split('utm_campaign=')[1]?.split('&')[0] || 'code'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    };

    // Convert SVG to data URL for the image
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    img.src = URL.createObjectURL(blob);
  });
}
