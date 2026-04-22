'use client';

import { useEffect, useState } from 'react';
import { useSiteSettings, useUpdateSettings } from '@/lib/cms/hooks';
import { Save } from 'lucide-react';

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
      )}

      {updateSettings.isError && (
        <p className="mt-4 text-sm text-ora-error">Failed to save settings. Please try again.</p>
      )}
    </div>
  );
}
