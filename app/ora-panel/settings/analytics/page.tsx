'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, ShieldAlert } from 'lucide-react';
import type { SessionData } from '@/lib/types/session';
import {
  PageHeaderSkeleton,
  DetailFormSkeleton,
} from '@/components/ui/panel-skeletons';

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

const ANALYTICS_KEYS = {
  posthogKey: 'analytics_posthog_key',
  posthogHost: 'analytics_posthog_host',
  reverseProxyPath: 'analytics_reverse_proxy_path',
  clarityId: 'analytics_clarity_id',
  ga4Id: 'analytics_ga4_id',
  metaPixelId: 'analytics_meta_pixel_id',
  metaCapiToken: 'analytics_meta_capi_token',
  googleAdsConversionId: 'analytics_google_ads_conversion_id',
  googleAdsConversionLabels: 'analytics_google_ads_labels',
  googleEnhancedConversions: 'analytics_google_enhanced_conversions',
  tiktokPixelId: 'analytics_tiktok_pixel_id',
  tiktokEventsApiToken: 'analytics_tiktok_events_api_token',
  bingUetTagId: 'analytics_bing_uet_tag_id',
  cookieConsentMode: 'analytics_consent_mode',
  attributionWindowDays: 'analytics_attribution_window',
  piiMaskInputs: 'analytics_pii_mask_inputs',
  piiMaskText: 'analytics_pii_mask_text',
} as const;

const DEFAULTS: Record<string, string> = {
  [ANALYTICS_KEYS.posthogHost]: 'https://eu.i.posthog.com',
  [ANALYTICS_KEYS.reverseProxyPath]: '/ingest',
  [ANALYTICS_KEYS.cookieConsentMode]: 'strict',
  [ANALYTICS_KEYS.attributionWindowDays]: '30',
  [ANALYTICS_KEYS.googleEnhancedConversions]: 'false',
  [ANALYTICS_KEYS.piiMaskInputs]: 'true',
  [ANALYTICS_KEYS.piiMaskText]: 'true',
};

// Sensitive fields that need encryption
const SENSITIVE_KEYS = new Set<string>([
  ANALYTICS_KEYS.metaCapiToken,
  ANALYTICS_KEYS.tiktokEventsApiToken,
]);

// ── Validation ───────────────────────────────────────────────────────────────

interface ValidationErrors {
  [key: string]: string;
}

const POSTHOG_KEY_PATTERN = /^phc_[a-zA-Z0-9]+$/;
const NUMERIC_ID_PATTERN = /^\d{0,32}$/;
const MAX_FIELD_LENGTH = 256;

function validate(values: Record<string, string>): ValidationErrors {
  const errors: ValidationErrors = {};

  // PostHog key is mandatory and must match pattern
  const posthogKey = values[ANALYTICS_KEYS.posthogKey] ?? '';
  if (!posthogKey.trim()) {
    errors[ANALYTICS_KEYS.posthogKey] = 'PostHog project API key is required';
  } else if (!POSTHOG_KEY_PATTERN.test(posthogKey)) {
    errors[ANALYTICS_KEYS.posthogKey] =
      'Must start with "phc_" followed by alphanumeric characters';
  }

  // Numeric ID fields: digits only, max 32 chars
  const numericFields = [
    { key: ANALYTICS_KEYS.clarityId, label: 'Clarity project ID' },
    { key: ANALYTICS_KEYS.metaPixelId, label: 'Meta Pixel ID' },
    { key: ANALYTICS_KEYS.tiktokPixelId, label: 'TikTok Pixel ID' },
    { key: ANALYTICS_KEYS.bingUetTagId, label: 'Bing UET tag ID' },
  ];

  for (const { key, label } of numericFields) {
    const val = values[key] ?? '';
    if (val && !NUMERIC_ID_PATTERN.test(val)) {
      errors[key] = `${label} must contain only digits (max 32 characters)`;
    }
  }

  // All text fields: max 256 chars
  const textKeys = Object.values(ANALYTICS_KEYS).filter(
    (k) =>
      k !== ANALYTICS_KEYS.googleEnhancedConversions &&
      k !== ANALYTICS_KEYS.piiMaskInputs &&
      k !== ANALYTICS_KEYS.piiMaskText &&
      k !== ANALYTICS_KEYS.cookieConsentMode &&
      k !== ANALYTICS_KEYS.attributionWindowDays
  );

  for (const key of textKeys) {
    const val = values[key] ?? '';
    if (val.length > MAX_FIELD_LENGTH) {
      errors[key] = `Maximum ${MAX_FIELD_LENGTH} characters allowed`;
    }
  }

  return errors;
}

// ── Page Component ───────────────────────────────────────────────────────────

export default function AnalyticsSettingsPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionData | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  // Admin role check
  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/auth/session`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Not authenticated');
        const json = await res.json();
        if (!json?.data?.userId) throw new Error('Not authenticated');
        return json.data as SessionData;
      })
      .then((data) => {
        if (cancelled) return;
        // Check for admin role: super_admin role or settings:update permission
        const isAdmin =
          data.roles.includes('super_admin') ||
          data.permissions.includes('*:*') ||
          data.permissions.includes('settings:update') ||
          data.permissions.includes('settings:*');
        if (!isAdmin) {
          setUnauthorized(true);
          setAuthLoading(false);
          // Redirect non-admins to dashboard
          router.replace('/ora-panel');
          return;
        }
        setSession(data);
        setAuthLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        router.replace('/ora-panel/login');
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (authLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeaderSkeleton />
        <DetailFormSkeleton sections={3} fieldsPerSection={2} className="max-w-3xl" />
      </div>
    );
  }

  if (unauthorized || !session) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <ShieldAlert className="h-8 w-8 text-ora-error" />
        <p className="text-sm text-ora-charcoal">
          You do not have permission to access analytics settings.
        </p>
      </div>
    );
  }

  return <AnalyticsSettingsForm />;
}

// ── Form Component ───────────────────────────────────────────────────────────

function AnalyticsSettingsForm() {
  const [settings, setSettings] = useState<{ key: string; value: string }[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);

  // Fetch analytics settings from dedicated endpoint (handles decryption)
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/analytics-settings`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch');
        const json = await res.json();
        setSettings(json.data ?? []);
      })
      .catch(() => {
        setSettings([]);
      })
      .finally(() => setIsLoading(false));
  }, []);

  // Populate form from fetched settings
  useEffect(() => {
    if (settings) {
      const map: Record<string, string> = {};
      for (const entry of settings) {
        if (entry.key.startsWith('analytics_')) {
          map[entry.key] = entry.value;
        }
      }
      // Apply defaults for missing values
      for (const [key, defaultVal] of Object.entries(DEFAULTS)) {
        if (!map[key]) {
          map[key] = defaultVal;
        }
      }
      setValues(map);
    }
  }, [settings]);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Clear error for this field on change
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleToggle = (key: string) => {
    setValues((prev) => ({
      ...prev,
      [key]: prev[key] === 'true' ? 'false' : 'true',
    }));
  };

  const handleSave = async () => {
    setSaved(false);
    setSaveError(false);
    const validationErrors = validate(values);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setSaving(true);
    try {
      // Build the settings payload — mark sensitive fields for server-side encryption
      const payload: Record<string, string> = {};
      for (const [, settingKey] of Object.entries(ANALYTICS_KEYS)) {
        const val = values[settingKey] ?? '';
        if (SENSITIVE_KEYS.has(settingKey) && val) {
          // Send sensitive values with a prefix so the server can encrypt them
          payload[settingKey] = `__ENCRYPT__${val}`;
        } else {
          payload[settingKey] = val;
        }
      }

      const res = await fetch(`${API_BASE_URL}/api/analytics-settings`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: payload }),
      });

      if (!res.ok) {
        throw new Error('Failed to save');
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <DetailFormSkeleton sections={3} fieldsPerSection={2} className="max-w-3xl" />
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Analytics Settings</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          Configure analytics providers, consent mode, and attribution settings
        </p>
      </div>

      {/* PostHog Configuration */}
      <Section title="PostHog">
        <Field
          label="Project API Key"
          hint="Required. Must start with phc_ followed by alphanumeric characters."
          value={values[ANALYTICS_KEYS.posthogKey] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.posthogKey, v)}
          error={errors[ANALYTICS_KEYS.posthogKey]}
          placeholder="phc_abc123..."
          required
        />
        <Field
          label="Host"
          value={values[ANALYTICS_KEYS.posthogHost] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.posthogHost, v)}
          error={errors[ANALYTICS_KEYS.posthogHost]}
          placeholder="https://eu.i.posthog.com"
        />
        <Field
          label="Reverse Proxy Path"
          value={values[ANALYTICS_KEYS.reverseProxyPath] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.reverseProxyPath, v)}
          error={errors[ANALYTICS_KEYS.reverseProxyPath]}
          placeholder="/ingest"
        />
      </Section>

      {/* Microsoft Clarity */}
      <Section title="Microsoft Clarity">
        <Field
          label="Project ID"
          hint="Digits only, max 32 characters."
          value={values[ANALYTICS_KEYS.clarityId] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.clarityId, v)}
          error={errors[ANALYTICS_KEYS.clarityId]}
          placeholder="1234567890"
        />
      </Section>

      {/* Google Analytics */}
      <Section title="Google Analytics 4">
        <Field
          label="Measurement ID"
          value={values[ANALYTICS_KEYS.ga4Id] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.ga4Id, v)}
          error={errors[ANALYTICS_KEYS.ga4Id]}
          placeholder="G-XXXXXXXXXX"
        />
      </Section>

      {/* Meta (Facebook) */}
      <Section title="Meta (Facebook)">
        <Field
          label="Pixel ID"
          hint="Digits only, max 32 characters."
          value={values[ANALYTICS_KEYS.metaPixelId] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.metaPixelId, v)}
          error={errors[ANALYTICS_KEYS.metaPixelId]}
          placeholder="1234567890123456"
        />
        <Field
          label="CAPI Access Token"
          hint="Sensitive — stored encrypted."
          value={values[ANALYTICS_KEYS.metaCapiToken] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.metaCapiToken, v)}
          error={errors[ANALYTICS_KEYS.metaCapiToken]}
          placeholder="EAAxxxxxxx..."
          type="password"
        />
      </Section>

      {/* Google Ads */}
      <Section title="Google Ads">
        <Field
          label="Conversion ID"
          value={values[ANALYTICS_KEYS.googleAdsConversionId] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.googleAdsConversionId, v)}
          error={errors[ANALYTICS_KEYS.googleAdsConversionId]}
          placeholder="AW-XXXXXXXXX"
        />
        <Field
          label="Conversion Labels"
          hint="Comma-separated labels for different conversion actions."
          value={values[ANALYTICS_KEYS.googleAdsConversionLabels] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.googleAdsConversionLabels, v)}
          error={errors[ANALYTICS_KEYS.googleAdsConversionLabels]}
          placeholder="label1, label2"
        />
        <Toggle
          label="Enhanced Conversions"
          checked={values[ANALYTICS_KEYS.googleEnhancedConversions] === 'true'}
          onChange={() => handleToggle(ANALYTICS_KEYS.googleEnhancedConversions)}
        />
      </Section>

      {/* TikTok */}
      <Section title="TikTok">
        <Field
          label="Pixel ID"
          hint="Digits only, max 32 characters."
          value={values[ANALYTICS_KEYS.tiktokPixelId] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.tiktokPixelId, v)}
          error={errors[ANALYTICS_KEYS.tiktokPixelId]}
          placeholder="1234567890123456789"
        />
        <Field
          label="Events API Token"
          hint="Sensitive — stored encrypted."
          value={values[ANALYTICS_KEYS.tiktokEventsApiToken] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.tiktokEventsApiToken, v)}
          error={errors[ANALYTICS_KEYS.tiktokEventsApiToken]}
          placeholder="Token..."
          type="password"
        />
      </Section>

      {/* Bing */}
      <Section title="Bing UET">
        <Field
          label="Tag ID"
          hint="Digits only, max 32 characters."
          value={values[ANALYTICS_KEYS.bingUetTagId] ?? ''}
          onChange={(v) => handleChange(ANALYTICS_KEYS.bingUetTagId, v)}
          error={errors[ANALYTICS_KEYS.bingUetTagId]}
          placeholder="12345678"
        />
      </Section>

      {/* Consent & Attribution */}
      <Section title="Consent & Attribution">
        <SelectField
          label="Cookie Consent Mode"
          value={values[ANALYTICS_KEYS.cookieConsentMode] ?? 'strict'}
          onChange={(v) => handleChange(ANALYTICS_KEYS.cookieConsentMode, v)}
          options={[
            { value: 'strict', label: 'Strict — all off until explicit consent' },
            { value: 'balanced', label: 'Balanced — analytics pre-checked' },
            { value: 'off', label: 'Off — no banner, all tracking active' },
          ]}
        />
        <SelectField
          label="Attribution Window"
          value={values[ANALYTICS_KEYS.attributionWindowDays] ?? '30'}
          onChange={(v) => handleChange(ANALYTICS_KEYS.attributionWindowDays, v)}
          options={[
            { value: '30', label: '30 days' },
            { value: '60', label: '60 days' },
            { value: '90', label: '90 days' },
          ]}
        />
      </Section>

      {/* PII Redaction */}
      <Section title="PII Redaction (Session Replay)">
        <Toggle
          label="Mask Inputs"
          description="Mask all input field values in session recordings"
          checked={values[ANALYTICS_KEYS.piiMaskInputs] === 'true'}
          onChange={() => handleToggle(ANALYTICS_KEYS.piiMaskInputs)}
        />
        <Toggle
          label="Mask Text"
          description="Mask all text content in session recordings"
          checked={values[ANALYTICS_KEYS.piiMaskText] === 'true'}
          onChange={() => handleToggle(ANALYTICS_KEYS.piiMaskText)}
        />
      </Section>

      {/* Save Button */}
      <div className="mt-6 flex items-center gap-3 pb-8">
        {saveError && (
          <span className="text-sm text-ora-error">Failed to save settings.</span>
        )}
        {saved && (
          <span className="text-sm text-emerald-700">Settings saved successfully.</span>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white hover:bg-ora-graphite transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4 stroke-1" />
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}

// ── Shared UI Components ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 border border-ora-sand/60 bg-ora-white p-6">
      <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">{title}</h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  error,
  placeholder,
  type = 'text',
  required,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  type?: 'text' | 'password';
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
        {label}
        {required && <span className="ml-1 text-ora-error">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={MAX_FIELD_LENGTH}
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

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:ring-1 focus-visible:ring-ora-gold focus-visible:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm font-medium text-ora-charcoal">{label}</span>
        {description && (
          <p className="text-[11px] text-ora-muted">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-ora-gold' : 'bg-ora-sand'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-ora-white transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </div>
  );
}
