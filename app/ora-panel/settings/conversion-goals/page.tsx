"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ShieldAlert, Power } from "lucide-react";
import type { SessionData } from "@/lib/types/session";
import { EVENT_VOCABULARY } from "@/lib/analytics/events";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "";
const DISPLAY_LABEL_MAX = 100;

interface ConversionGoal {
  id: string;
  eventName: string;
  displayLabel: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CustomEvent {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export default function ConversionGoalsPage() {
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
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-sm text-ora-muted">Loading…</p>
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3">
        <ShieldAlert className="h-8 w-8 text-ora-error" />
        <p className="text-sm text-ora-charcoal">
          You do not have permission to manage conversion goals.
        </p>
      </div>
    );
  }

  return <ConversionGoalsContent />;
}

function ConversionGoalsContent() {
  const queryClient = useQueryClient();
  const [selectedEvent, setSelectedEvent] = useState("");
  const [displayLabel, setDisplayLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Fetch existing conversion goals
  const { data: goals, isLoading: goalsLoading } = useQuery({
    queryKey: ["conversion-goals"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/conversion-goals`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load conversion goals");
      const json = await res.json();
      return (json.data ?? []) as ConversionGoal[];
    },
  });

  // Fetch custom events for the selector dropdown
  const { data: customEvents, isError: eventsError } = useQuery({
    queryKey: ["custom-events-for-goals"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/custom-events`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load custom events");
      const json = await res.json();
      return (json.data ?? []) as CustomEvent[];
    },
  });

  // Build sorted event list: core EVENT_VOCABULARY + active custom events
  const availableEvents = (() => {
    const coreEvents = [...EVENT_VOCABULARY] as string[];
    const customEventNames = (customEvents ?? [])
      .filter((e) => e.isActive)
      .map((e) => e.name);
    const allEvents = [...new Set([...coreEvents, ...customEventNames])];
    allEvents.sort((a, b) => a.localeCompare(b));
    return allEvents;
  })();

  const createMutation = useMutation({
    mutationFn: async (payload: { eventName: string; displayLabel?: string }) => {
      const res = await fetch(`${API_BASE_URL}/api/conversion-goals`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create");
      return json.data as ConversionGoal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversion-goals"] });
      setSelectedEvent("");
      setDisplayLabel("");
      setError(null);
    },
    onError: (err: Error) => setError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await fetch(`${API_BASE_URL}/api/conversion-goals/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      return json.data;
    },
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: ["conversion-goals"] });
      const previous = queryClient.getQueryData<ConversionGoal[]>(["conversion-goals"]);
      queryClient.setQueryData<ConversionGoal[]>(["conversion-goals"], (old) =>
        old?.map((g) => (g.id === id ? { ...g, isActive } : g)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["conversion-goals"], context.previous);
      }
      setError("Failed to update goal status");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["conversion-goals"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_BASE_URL}/api/conversion-goals/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to delete");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversion-goals"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const handleCreate = () => {
    setError(null);
    if (!selectedEvent) {
      setError("Please select an event");
      return;
    }
    if (displayLabel.length > DISPLAY_LABEL_MAX) {
      setError(`Display label must be at most ${DISPLAY_LABEL_MAX} characters`);
      return;
    }
    createMutation.mutate({
      eventName: selectedEvent,
      displayLabel: displayLabel.trim() || undefined,
    });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-ora-charcoal">Conversion Goals</h1>
        <p className="mt-1 text-sm text-ora-charcoal-light">
          Configure which events count as conversions in the marketing dashboard.
        </p>
      </div>

      {/* Add new conversion goal */}
      <section className="mb-8 border border-ora-sand/60 bg-ora-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">Add conversion goal</h2>

        {eventsError ? (
          <p className="text-xs text-ora-error">
            Could not load events. Please try again later.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                Event name <span className="text-ora-error">*</span>
              </label>
              <select
                value={selectedEvent}
                onChange={(e) => {
                  setSelectedEvent(e.target.value);
                  setError(null);
                }}
                className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
              >
                <option value="">Select an event…</option>
                {availableEvents.map((evt) => (
                  <option key={evt} value={evt}>
                    {evt}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-ora-muted">
                Core and custom events available for tracking.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-ora-charcoal-light">
                Display label
              </label>
              <input
                type="text"
                value={displayLabel}
                onChange={(e) => {
                  setDisplayLabel(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. Lead Qualified, Reservation Complete"
                maxLength={DISPLAY_LABEL_MAX}
                className="h-10 w-full border border-ora-stone bg-ora-white px-4 text-sm text-ora-charcoal placeholder:text-ora-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ora-gold"
              />
              <p className="mt-1 text-[11px] text-ora-muted">
                Optional. Max {DISPLAY_LABEL_MAX} characters. Shown in dashboard if set.
              </p>
            </div>
            {error && <p className="text-xs text-ora-error">{error}</p>}
            <div>
              <button
                onClick={handleCreate}
                disabled={createMutation.isPending || eventsError}
                className="inline-flex h-10 items-center gap-2 bg-ora-charcoal px-6 text-sm text-ora-white transition-colors hover:bg-ora-graphite disabled:opacity-50"
              >
                <Plus className="h-4 w-4 stroke-1" />
                {createMutation.isPending ? "Adding…" : "Add goal"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Existing conversion goals */}
      <section className="border border-ora-sand/60 bg-ora-white p-6">
        <h2 className="mb-4 text-sm font-semibold text-ora-charcoal">Configured goals</h2>
        {goalsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-ora-sand/40" />
            ))}
          </div>
        ) : !goals?.length ? (
          <p className="py-4 text-center text-sm text-ora-muted">
            No conversion goals configured yet. Add one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-ora-sand/60 text-ora-charcoal-light">
                  <th className="pb-2 pr-3 font-medium">Event</th>
                  <th className="pb-2 pr-3 font-medium">Display Label</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 pr-3 font-medium">Created</th>
                  <th className="pb-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((goal) => (
                  <tr
                    key={goal.id}
                    className="border-b border-ora-sand/30 last:border-0"
                  >
                    <td className="py-2.5 pr-3 font-medium text-ora-charcoal">
                      {goal.eventName}
                    </td>
                    <td className="py-2.5 pr-3 text-ora-charcoal-light">
                      {goal.displayLabel || "—"}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-flex h-5 items-center px-2 text-[10px] ${
                          goal.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-ora-sand/40 text-ora-muted"
                        }`}
                      >
                        {goal.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-ora-muted">
                      {new Date(goal.createdAt).toLocaleDateString("en-GB", {
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
                              id: goal.id,
                              isActive: !goal.isActive,
                            })
                          }
                          className="inline-flex h-7 w-7 items-center justify-center text-ora-muted hover:text-ora-charcoal transition-colors"
                          title={goal.isActive ? "Deactivate" : "Activate"}
                          aria-label={goal.isActive ? "Deactivate" : "Activate"}
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                `Delete "${goal.displayLabel || goal.eventName}"? This will remove the goal from dashboard tracking.`,
                              )
                            ) {
                              deleteMutation.mutate(goal.id);
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
