'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Cog } from 'lucide-react';

export default function AISettingsPage() {
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
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-ora-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">AI Settings</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">Configure ORA AI assistant behavior</p>
      </div>

      <div className="max-w-2xl space-y-6">
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
    </div>
  );
}
