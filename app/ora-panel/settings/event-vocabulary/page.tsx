"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShieldAlert, Lock, Power } from "lucide-react";
import type { SessionData } from "@/lib/types/session";
import { EVENT_VOCABULARY, CUSTOM_EVENT_NAME_PATTERN } from "@/lib/analytics/events";
import { refreshCustomEvents } from "@/lib/analytics/custom-events-store";
import { PageHeaderSkeleton, ListSkeleton } from "@/components/ui/panel-skeletons";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";
const NAME_MAX = 64;
const DESC_MAX = 200;

interface CustomEvent {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export default function EventVocabularyPage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/api/auth/session`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Not authenticated");
        const json = await res.json();
        if (!json?.data?.userId) throw new Error("Not authenticated");
        return json.data as SessionData;
      })
      .then((data) => {
        if (cancelled) return;
        const isAdmin =
          data.roles.includes("super_admin") ||
          data.permissions.includes("*:*") ||
          data.permissions.includes("settings:update") ||
          data.permissions.includes("settings:*");
        if (!isAdmin) {
          setUnauthorized(true);
          setAuthLoading(false);
          router.replace("/ora-panel");
          return;
        }
        setAuthLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        router.replace("/ora-panel/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (authLoading) {
    return (
      <div>
        <PageHeaderSkeleton />
        <ListSkeleton rows={4} />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <ShieldAlert className="h-8 w-8 text-ora-error" />
        <p className="text-sm text-ora-charcoal">
          You do not have permission to manage event vocabulary.
        </p>
      </div>
    );
  }

  return <EventVocabularyContent />;
}

function EventVocabularyContent() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: events, isLoading } = useQuery({
    queryKey: ["custom-events"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/custom-events?includeInactive=true`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load custom events");
      const json = await res.json();
      return (json.data ?? []) as CustomEvent[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; description: string }) => {
      const res = await fetch(`${API_BASE_URL}/api/custom-events`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      return json.data as CustomEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-events"] });
      void refreshCustomEvents();
      setName("");
      setDescription("");
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`${API_BASE_URL}/api/custom-events/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-events"] });
      void refreshCustomEvents();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE_URL}/api/custom-events/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-events"] });
      void refreshCustomEvents();
    },
  });

  const validateLocally = (): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return "Name is required";
    if (trimmed.length > NAME_MAX) return `Maximum ${NAME_MAX} characters`;
    if (!CUSTOM_EVENT_NAME_PATTERN.test(trimmed)) {
      return "Lowercase letters, digits, and underscores only; must start with a letter";
    }
    if ((EVENT_VOCABULARY as readonly string[]).includes(trimmed)) {
      return "This name is part of the core vocabulary";
    }
    if (description.length > DESC_MAX) {
      return `Description must be at most ${DESC_MAX} characters`;
    }
    return null;
  };

  const handleCreate = () => {
    const validationError = validateLocally();
    if (validationError) {
      setError(validationError);
      return;
    }
    createMutation.mutate({ name: name.trim(), description: description.trim() });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Event Vocabulary</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          Manage the analytics events available in the page builder.
        </p>
      </div>

      {/* Core (locked) vocabulary */}
      <section className="mb-8 border border-ora-sand/60 bg-ora-white p-6">
        <div className="mb-3 flex items-center gap-2">
          <Lock className="h-4 w-4 text-ora-muted" />
          <h2 className="text-sm font-semibold text-ora-charcoal">Core vocabulary</h2>
          <span className="text-[11px] text-ora-muted">read-only</span>
        </div>
        <p className="mb-4 text-xs text-ora-charcoal-light">
          These events are guaranteed to exist. They power built-in funnels and
          require a code change to modify.
        </p>
        <div className="flex flex-wrap gap-2">
          {EVENT_VOCABULARY.map((evt) => (
            <span
              key={evt}
              className="inline-flex h-6 items-center bg-ora-sand/30 px-2 text-[11px] text-ora-charcoal"
            >
              {evt}
            </span>
          ))}
        </div>
      </section>

      {/* Add new custom event */}
      <section className="mb-8 border border-ora-sand/60 bg-ora-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">Add custom event</h2>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
              Event name <span className="text-ora-error">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="e.g. video_played, brochure_downloaded"
              maxLength={NAME_MAX}
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
            />
            <p className="mt-1 text-[11px] text-ora-muted">
              Lowercase, snake_case. Starts with a letter. Max {NAME_MAX} chars.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="When does this event fire?"
              maxLength={DESC_MAX}
              className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
            />
          </div>
          {error && <p className="text-xs text-ora-error">{error}</p>}
          <div>
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white transition-colors hover:bg-ora-graphite disabled:opacity-50"
            >
              <Plus className="h-4 w-4 stroke-1" />
              {createMutation.isPending ? "Adding…" : "Add event"}
            </button>
          </div>
        </div>
      </section>

      {/* Existing custom events */}
      <section className="border border-ora-sand/60 bg-ora-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">Custom events</h2>
        {isLoading ? (
          <ListSkeleton rows={3} rowClassName="h-12 bg-ora-sand/40" />
        ) : !events?.length ? (
          <p className="py-4 text-center text-sm text-ora-muted">
            No custom events yet. Add one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ora-sand/60 text-ora-charcoal-light">
                  <th className="pb-2 pr-3 font-medium">Name</th>
                  <th className="pb-2 pr-3 font-medium">Description</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Created</th>
                  <th className="pb-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((evt) => (
                  <tr
                    key={evt.id}
                    className="border-b border-ora-sand/30 last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-medium text-ora-charcoal">
                      {evt.name}
                    </td>
                    <td className="py-2.5 pr-3 text-ora-charcoal-light">
                      {evt.description || "—"}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-flex h-5 items-center px-2 text-[10px] ${
                          evt.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-ora-sand/40 text-ora-muted"
                        }`}
                      >
                        {evt.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-ora-muted">
                      {new Date(evt.createdAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="py-2.5">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() =>
                            toggleMutation.mutate({
                              id: evt.id,
                              isActive: !evt.isActive,
                            })
                          }
                          className="inline-flex h-7 w-7 items-center justify-center text-ora-muted hover:text-ora-charcoal transition-colors"
                          title={evt.isActive ? "Deactivate" : "Activate"}
                          aria-label={evt.isActive ? "Deactivate" : "Activate"}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                `Delete "${evt.name}"? Any pages using this event will fall back silently.`,
                              )
                            ) {
                              deleteMutation.mutate(evt.id);
                            }
                          }}
                          className="inline-flex h-7 w-7 items-center justify-center text-ora-muted hover:text-ora-error transition-colors"
                          title="Delete"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
