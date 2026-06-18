"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, DollarSign } from "lucide-react";
import { ListSkeleton } from "@/components/ui/panel-skeletons";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";

const CHANNEL_OPTIONS = [
  { value: "meta", label: "Meta (Facebook/Instagram)" },
  { value: "google", label: "Google Ads" },
  { value: "tiktok", label: "TikTok Ads" },
  { value: "bing", label: "Bing (Microsoft) Ads" },
  { value: "linkedin", label: "LinkedIn Ads" },
  { value: "snapchat", label: "Snapchat Ads" },
  { value: "other", label: "Other" },
];

interface SpendRecord {
  id: string;
  date: string;
  channel: string;
  campaignId: string;
  adSetId: string | null;
  adId: string | null;
  spend: string;
  impressions: number;
  clicks: number;
  currency: string;
  createdAt: string;
}

export default function MarketingSpendPage() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [channel, setChannel] = useState("meta");
  const [campaignId, setCampaignId] = useState("");
  const [adSetId, setAdSetId] = useState("");
  const [spend, setSpend] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: records, isLoading } = useQuery({
    queryKey: ["marketing-spend"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/marketing-spend`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      return (json.data ?? []) as SpendRecord[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch(`${API_BASE_URL}/api/marketing-spend`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketing-spend"] });
      setCampaignId("");
      setAdSetId("");
      setSpend("");
      setImpressions("");
      setClicks("");
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE_URL}/api/marketing-spend/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["marketing-spend"] });
    },
  });

  const handleSubmit = () => {
    if (!campaignId.trim()) {
      setError("Campaign ID is required");
      return;
    }
    if (!spend || isNaN(Number(spend)) || Number(spend) < 0) {
      setError("Spend must be a valid positive number");
      return;
    }
    createMutation.mutate({
      date,
      channel,
      campaignId: campaignId.trim(),
      adSetId: adSetId.trim() || null,
      adId: null,
      spend: Number(spend).toFixed(2),
      impressions: parseInt(impressions) || 0,
      clicks: parseInt(clicks) || 0,
      currency: "AED",
    });
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Ad Spend</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          Manually enter ad spend data or let the automated ingestion script pull from ad platforms.
        </p>
      </div>

      {/* Entry form */}
      <div className="mb-8 border border-ora-sand/60 bg-ora-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">Add spend entry</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Channel</label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
            >
              {CHANNEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
              Campaign ID <span className="text-ora-error">*</span>
            </label>
            <input
              type="text"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              placeholder="marina_q1_awareness"
              className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Ad Set ID</label>
            <input
              type="text"
              value={adSetId}
              onChange={(e) => setAdSetId(e.target.value)}
              placeholder="Optional"
              className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
              Spend (AED) <span className="text-ora-error">*</span>
            </label>
            <input
              type="number"
              value={spend}
              onChange={(e) => setSpend(e.target.value)}
              placeholder="1500.00"
              min="0"
              step="0.01"
              className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Impressions</label>
            <input
              type="number"
              value={impressions}
              onChange={(e) => setImpressions(e.target.value)}
              placeholder="0"
              min="0"
              className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">Clicks</label>
            <input
              type="number"
              value={clicks}
              onChange={(e) => setClicks(e.target.value)}
              placeholder="0"
              min="0"
              className="h-10 w-full border border-ora-stone bg-ora-white px-3 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
            />
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-ora-error">{error}</p>}
        <div className="mt-4">
          <button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white transition-colors hover:bg-ora-graphite disabled:opacity-50"
          >
            <Plus className="h-4 w-4 stroke-1" />
            {createMutation.isPending ? "Adding…" : "Add Entry"}
          </button>
        </div>
      </div>

      {/* Spend table */}
      <div className="border border-ora-sand/60 bg-ora-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">Recent entries</h2>
        {isLoading ? (
          <ListSkeleton rows={3} rowClassName="h-10 bg-ora-sand/40 rounded-none" className="space-y-2" />
        ) : !records?.length ? (
          <div className="py-8 text-center">
            <DollarSign className="mx-auto mb-2 h-8 w-8 stroke-1 text-ora-muted" />
            <p className="text-sm text-ora-muted">No spend data yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ora-sand/60 text-ora-charcoal-light">
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Channel</th>
                  <th className="pb-2 pr-3 font-medium">Campaign</th>
                  <th className="pb-2 pr-3 text-right font-medium">Spend</th>
                  <th className="pb-2 pr-3 text-right font-medium">Impr.</th>
                  <th className="pb-2 pr-3 text-right font-medium">Clicks</th>
                  <th className="pb-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-ora-sand/30 last:border-0">
                    <td className="py-2 pr-3 text-ora-charcoal">{r.date}</td>
                    <td className="py-2 pr-3 capitalize text-ora-charcoal-light">{r.channel}</td>
                    <td className="py-2 pr-3 font-medium text-ora-charcoal">{r.campaignId}</td>
                    <td className="py-2 pr-3 text-right text-ora-charcoal">AED {parseFloat(r.spend).toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right text-ora-muted">{r.impressions.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right text-ora-muted">{r.clicks.toLocaleString()}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => deleteMutation.mutate(r.id)}
                        className="inline-flex h-7 w-7 items-center justify-center text-ora-muted hover:text-ora-error transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
