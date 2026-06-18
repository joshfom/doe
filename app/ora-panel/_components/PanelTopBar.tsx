'use client';

// ── Panel top bar (top-right) ─────────────────────────────────────────────────
// Shows the signed-in user's name and a session-only "view as" persona toggle
// for the demo. The toggle never changes real permissions — it only sets the
// persona hint the twin uses (see demo-persona.tsx). A small "Demo" tag makes it
// clear this is a presentation aid, not a security control.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, UserCircle2, Check } from 'lucide-react';
import { useDemoPersona } from './demo-persona';

export function PanelTopBar({ userName }: { userName?: string | null }) {
  const { persona, setPersona, presets } = useDemoPersona();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const current = presets.find((p) => p.id === persona) ?? presets[0];

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className="fixed right-5 top-4 z-50"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-full border border-ora-sand/70 bg-ora-white/90 py-1.5 pl-2.5 pr-3 shadow-ora-sm backdrop-blur transition-colors hover:bg-ora-white"
      >
        <UserCircle2 className="h-6 w-6 stroke-[1.5] text-ora-charcoal-light" />
        <span className="flex flex-col items-start leading-tight">
          <span className="text-sm font-medium text-ora-charcoal">
            {userName?.trim() || 'You'}
          </span>
          <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-ora-gold-dark">
            Viewing as {current?.label}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 stroke-[1.5] text-ora-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl border border-ora-sand/70 bg-ora-white shadow-ora-lg"
        >
          <div className="flex items-center justify-between border-b border-ora-sand/50 bg-ora-cream-light/60 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ora-charcoal-light">
              View as (demo)
            </span>
            <span className="rounded-full bg-ora-sand/50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ora-charcoal-light">
              Session only
            </span>
          </div>
          <ul className="py-1">
            {presets.map((p) => {
              const active = p.id === persona;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      setPersona(p.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      active ? 'bg-ora-cream' : 'hover:bg-ora-cream-light'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        active
                          ? 'border-ora-gold bg-ora-gold text-ora-white'
                          : 'border-ora-stone'
                      }`}
                    >
                      {active && <Check className="h-3 w-3 stroke-[2.5]" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ora-charcoal">
                        {p.label}
                      </span>
                      <span className="block truncate text-xs text-ora-muted">
                        {p.hint}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-ora-sand/50 px-3 py-2 text-[11px] leading-snug text-ora-muted">
            Changes the twin&apos;s tone &amp; data lens for this session only — not your
            real role or permissions.
          </p>
        </div>
      )}
    </div>
  );
}

export default PanelTopBar;
