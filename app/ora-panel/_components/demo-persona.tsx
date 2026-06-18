'use client';

// ── Demo persona (session-only, no DB) ────────────────────────────────────────
// A purely client-side "what role am I right now" switch for the demo. It does
// NOT change the user's real DB role or permissions — it only sets a persona
// hint that the panel chat forwards to the Home/twin agent so the twin's tone,
// depth and default data scope visibly adapt (C-level strategic vs operational)
// without re-seeding the DB or re-logging in. Persisted to localStorage so it
// survives refreshes within the demo session.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface DemoPersonaPreset {
  /** Role hint sent to the agent (maps to a Twin_Persona via the server). */
  id: string;
  /** Short label for the toggle. */
  label: string;
  /** One-line description of the lens. */
  hint: string;
}

/**
 * The selectable demo lenses. `c_level` resolves (server-side) to a strategic,
 * summary, org-wide persona; the others resolve to an operational, detailed,
 * own-scope persona — enough to show the twin adapting live.
 */
export const DEMO_PERSONAS: readonly DemoPersonaPreset[] = [
  { id: 'c_level', label: 'C-Level', hint: 'Strategic · summary · org-wide' },
  { id: 'sales_manager', label: 'Sales Manager', hint: 'Operational · pipeline focus' },
  { id: 'project_manager', label: 'Project Manager', hint: 'Operational · site & delivery' },
  { id: 'marketing', label: 'Marketing', hint: 'Operational · attribution & spend' },
] as const;

const STORAGE_KEY = 'doe.demoPersona';
const DEFAULT_PERSONA = DEMO_PERSONAS[0]!.id;

interface DemoPersonaContextValue {
  persona: string;
  setPersona: (id: string) => void;
  presets: readonly DemoPersonaPreset[];
}

const DemoPersonaContext = createContext<DemoPersonaContextValue | null>(null);

export function DemoPersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState<string>(DEFAULT_PERSONA);

  // Hydrate from localStorage on mount (client-only).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved && DEMO_PERSONAS.some((p) => p.id === saved)) {
        setPersonaState(saved);
      }
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const setPersona = useCallback((id: string) => {
    setPersonaState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const value = useMemo(
    () => ({ persona, setPersona, presets: DEMO_PERSONAS }),
    [persona, setPersona],
  );

  return (
    <DemoPersonaContext.Provider value={value}>
      {children}
    </DemoPersonaContext.Provider>
  );
}

/**
 * Read the current demo persona. Safe to call outside the provider (returns the
 * default + a no-op setter) so chat surfaces never crash if unwrapped.
 */
export function useDemoPersona(): DemoPersonaContextValue {
  const ctx = useContext(DemoPersonaContext);
  if (ctx) return ctx;
  return { persona: DEFAULT_PERSONA, setPersona: () => {}, presets: DEMO_PERSONAS };
}
