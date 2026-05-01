'use client';

/**
 * Structured repeatable editors for the project admin form.
 *
 * Each editor manages an ordered array of typed entities and exposes them
 * via `value` / `onChange`. Field names match the corresponding interfaces
 * in `lib/cms/types.ts` exactly so the array can be sent straight to the
 * `updateProject` mutation.
 */

import {
  type ProjectAmenity,
  type ProjectFloorplan,
  type ProjectLocationHighlight,
  type ProjectPaymentMilestone,
  type ProjectPaymentPlan,
} from '@/lib/cms/types';
import { MediaIdPicker } from '@/lib/cms/components/MediaIdPicker';

// ── Field primitives (kept minimal so editors stay declarative) ─────────────

const labelCls =
  'mb-1 block text-[10px] font-medium uppercase tracking-wide text-ora-muted';
const inputCls =
  'h-9 w-full border border-ora-sand bg-ora-white px-2 text-sm focus:border-ora-gold focus:outline-none';

function TextRow({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  rtl,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  rtl?: boolean;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input
        type={type}
        value={value ?? ''}
        dir={rtl ? 'rtl' : undefined}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    </label>
  );
}

function TextAreaRow({
  label,
  value,
  onChange,
  rtl,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  rtl?: boolean;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <textarea
        value={value ?? ''}
        dir={rtl ? 'rtl' : undefined}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full border border-ora-sand bg-ora-white p-2 text-sm focus:border-ora-gold focus:outline-none"
      />
    </label>
  );
}

function RowFrame({
  index,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  children,
}: {
  index: number;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-ora-sand bg-ora-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ora-muted">
          #{index + 1}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="h-7 w-7 border border-ora-sand text-xs hover:bg-ora-cream disabled:opacity-30"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="h-7 w-7 border border-ora-sand text-xs hover:bg-ora-cream disabled:opacity-30"
            aria-label="Move down"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="h-7 border border-ora-sand px-2 text-xs text-ora-error hover:bg-ora-error/10"
          >
            Remove
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function moveItem<T>(arr: T[], idx: number, dir: -1 | 1): T[] {
  const next = [...arr];
  const t = idx + dir;
  if (t < 0 || t >= next.length) return arr;
  [next[idx], next[t]] = [next[t], next[idx]];
  return next;
}

function num(raw: string): number | undefined {
  if (raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// ── Floorplans ──────────────────────────────────────────────────────────────

export function FloorplanEditor({
  value,
  onChange,
}: {
  value: ProjectFloorplan[];
  onChange: (next: ProjectFloorplan[]) => void;
}) {
  function update(idx: number, patch: Partial<ProjectFloorplan>) {
    onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  return (
    <div className="space-y-2">
      {value.map((fp, idx) => (
        <RowFrame
          key={idx}
          index={idx}
          onRemove={() => onChange(value.filter((_, i) => i !== idx))}
          onMoveUp={() => onChange(moveItem(value, idx, -1))}
          onMoveDown={() => onChange(moveItem(value, idx, 1))}
          canMoveUp={idx > 0}
          canMoveDown={idx < value.length - 1}
        >
          <div className="grid grid-cols-2 gap-3">
            <TextRow
              label="Unit type *"
              value={fp.unitType}
              onChange={(v) => update(idx, { unitType: v })}
              placeholder="e.g. 2BR-A"
            />
            <TextRow
              label="Area (sqm)"
              type="number"
              value={fp.areaSqm}
              onChange={(v) => update(idx, { areaSqm: num(v) })}
            />
            <TextRow
              label="Name (EN)"
              value={fp.nameEn}
              onChange={(v) => update(idx, { nameEn: v || undefined })}
            />
            <TextRow
              label="Name (AR)"
              value={fp.nameAr}
              onChange={(v) => update(idx, { nameAr: v || undefined })}
              rtl
            />
            <TextRow
              label="Bedrooms"
              type="number"
              value={fp.bedrooms}
              onChange={(v) => update(idx, { bedrooms: num(v) })}
            />
            <TextRow
              label="Bathrooms"
              type="number"
              value={fp.bathrooms}
              onChange={(v) => update(idx, { bathrooms: num(v) })}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <MediaIdPicker
              label="Floorplan image"
              value={fp.imageId}
              onChange={(id) => update(idx, { imageId: id ?? undefined })}
              mimeTypeFilter="image/"
              size="sm"
            />
            <MediaIdPicker
              label="Floorplan PDF"
              value={fp.pdfId}
              onChange={(id) => update(idx, { pdfId: id ?? undefined })}
              mimeTypeFilter="application/pdf"
              size="sm"
            />
          </div>
        </RowFrame>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, { unitType: '' }])}
        className="inline-flex h-9 items-center border border-ora-sand bg-ora-white px-4 text-xs hover:bg-ora-cream"
      >
        + Add floorplan
      </button>
    </div>
  );
}

// ── Amenities ───────────────────────────────────────────────────────────────

export function AmenityEditor({
  value,
  onChange,
}: {
  value: ProjectAmenity[];
  onChange: (next: ProjectAmenity[]) => void;
}) {
  function update(idx: number, patch: Partial<ProjectAmenity>) {
    onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  return (
    <div className="space-y-2">
      {value.map((a, idx) => (
        <RowFrame
          key={idx}
          index={idx}
          onRemove={() => onChange(value.filter((_, i) => i !== idx))}
          onMoveUp={() => onChange(moveItem(value, idx, -1))}
          onMoveDown={() => onChange(moveItem(value, idx, 1))}
          canMoveUp={idx > 0}
          canMoveDown={idx < value.length - 1}
        >
          <div className="grid grid-cols-2 gap-3">
            <TextRow
              label="Name (EN) *"
              value={a.nameEn}
              onChange={(v) => update(idx, { nameEn: v })}
            />
            <TextRow
              label="Name (AR)"
              value={a.nameAr}
              onChange={(v) => update(idx, { nameAr: v || undefined })}
              rtl
            />
            <TextRow
              label="Icon (lucide name)"
              value={a.icon}
              onChange={(v) => update(idx, { icon: v || undefined })}
              placeholder="e.g. Waves"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <TextAreaRow
              label="Description (EN)"
              value={a.descriptionEn}
              onChange={(v) =>
                update(idx, { descriptionEn: v || undefined })
              }
            />
            <TextAreaRow
              label="Description (AR)"
              value={a.descriptionAr}
              onChange={(v) =>
                update(idx, { descriptionAr: v || undefined })
              }
              rtl
            />
          </div>
          <div className="mt-3">
            <MediaIdPicker
              label="Image"
              value={a.imageId}
              onChange={(id) => update(idx, { imageId: id ?? undefined })}
              mimeTypeFilter="image/"
              size="sm"
            />
          </div>
        </RowFrame>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, { nameEn: '' }])}
        className="inline-flex h-9 items-center border border-ora-sand bg-ora-white px-4 text-xs hover:bg-ora-cream"
      >
        + Add amenity
      </button>
    </div>
  );
}

// ── Location highlights ─────────────────────────────────────────────────────

export function LocationHighlightEditor({
  value,
  onChange,
}: {
  value: ProjectLocationHighlight[];
  onChange: (next: ProjectLocationHighlight[]) => void;
}) {
  function update(idx: number, patch: Partial<ProjectLocationHighlight>) {
    onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  return (
    <div className="space-y-2">
      {value.map((h, idx) => (
        <RowFrame
          key={idx}
          index={idx}
          onRemove={() => onChange(value.filter((_, i) => i !== idx))}
          onMoveUp={() => onChange(moveItem(value, idx, -1))}
          onMoveDown={() => onChange(moveItem(value, idx, 1))}
          canMoveUp={idx > 0}
          canMoveDown={idx < value.length - 1}
        >
          <div className="grid grid-cols-3 gap-3">
            <TextRow
              label="Title (EN) *"
              value={h.titleEn}
              onChange={(v) => update(idx, { titleEn: v })}
            />
            <TextRow
              label="Title (AR)"
              value={h.titleAr}
              onChange={(v) => update(idx, { titleAr: v || undefined })}
              rtl
            />
            <TextRow
              label="Distance (km)"
              type="number"
              value={h.distanceKm}
              onChange={(v) => update(idx, { distanceKm: num(v) })}
            />
          </div>
        </RowFrame>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, { titleEn: '' }])}
        className="inline-flex h-9 items-center border border-ora-sand bg-ora-white px-4 text-xs hover:bg-ora-cream"
      >
        + Add highlight
      </button>
    </div>
  );
}

// ── Payment plans ───────────────────────────────────────────────────────────

export function PaymentPlanEditor({
  value,
  onChange,
}: {
  value: ProjectPaymentPlan[];
  onChange: (next: ProjectPaymentPlan[]) => void;
}) {
  function update(idx: number, patch: Partial<ProjectPaymentPlan>) {
    onChange(value.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  }
  function updateMilestone(
    planIdx: number,
    msIdx: number,
    patch: Partial<ProjectPaymentMilestone>
  ) {
    const plan = value[planIdx];
    const next = plan.milestones.map((m, i) =>
      i === msIdx ? { ...m, ...patch } : m
    );
    update(planIdx, { milestones: next });
  }
  return (
    <div className="space-y-2">
      {value.map((p, idx) => {
        const total =
          (p.downPaymentPct ?? 0) +
          p.milestones.reduce((s, m) => s + (m.pct ?? 0), 0);
        const totalOff = Math.round(Math.abs(total - 100) * 100) / 100;
        return (
          <RowFrame
            key={idx}
            index={idx}
            onRemove={() => onChange(value.filter((_, i) => i !== idx))}
            onMoveUp={() => onChange(moveItem(value, idx, -1))}
            onMoveDown={() => onChange(moveItem(value, idx, 1))}
            canMoveUp={idx > 0}
            canMoveDown={idx < value.length - 1}
          >
            <div className="grid grid-cols-3 gap-3">
              <TextRow
                label="Plan name (EN) *"
                value={p.nameEn}
                onChange={(v) => update(idx, { nameEn: v })}
              />
              <TextRow
                label="Plan name (AR)"
                value={p.nameAr}
                onChange={(v) => update(idx, { nameAr: v || undefined })}
                rtl
              />
              <TextRow
                label="Down payment %"
                type="number"
                value={p.downPaymentPct}
                onChange={(v) => update(idx, { downPaymentPct: num(v) })}
              />
            </div>
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ora-muted">
                  Milestones
                </p>
                <span
                  className={`text-[10px] ${
                    totalOff < 0.01
                      ? 'text-ora-success'
                      : 'text-ora-warning'
                  }`}
                >
                  Total {total}% {totalOff < 0.01 ? '✓' : `(off by ${totalOff})`}
                </span>
              </div>
              {p.milestones.length === 0 && (
                <p className="text-[11px] text-ora-muted">No milestones yet.</p>
              )}
              {p.milestones.map((m, mi) => (
                <div
                  key={mi}
                  className="grid grid-cols-[80px_1fr_1fr_auto] items-end gap-2 border border-ora-sand/60 bg-ora-cream/40 p-2"
                >
                  <TextRow
                    label="%"
                    type="number"
                    value={m.pct}
                    onChange={(v) =>
                      updateMilestone(idx, mi, { pct: num(v) ?? 0 })
                    }
                  />
                  <TextRow
                    label="Label (EN)"
                    value={m.labelEn}
                    onChange={(v) =>
                      updateMilestone(idx, mi, { labelEn: v })
                    }
                  />
                  <TextRow
                    label="Label (AR)"
                    value={m.labelAr}
                    onChange={(v) =>
                      updateMilestone(idx, mi, { labelAr: v || undefined })
                    }
                    rtl
                  />
                  <button
                    type="button"
                    onClick={() =>
                      update(idx, {
                        milestones: p.milestones.filter((_, i) => i !== mi),
                      })
                    }
                    className="h-9 border border-ora-sand px-2 text-xs text-ora-error hover:bg-ora-error/10"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  update(idx, {
                    milestones: [
                      ...p.milestones,
                      { pct: 0, labelEn: '' } as ProjectPaymentMilestone,
                    ],
                  })
                }
                className="inline-flex h-8 items-center border border-ora-sand bg-ora-white px-3 text-[11px] hover:bg-ora-cream"
              >
                + Add milestone
              </button>
            </div>
          </RowFrame>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onChange([...value, { nameEn: '', milestones: [] }])
        }
        className="inline-flex h-9 items-center border border-ora-sand bg-ora-white px-4 text-xs hover:bg-ora-cream"
      >
        + Add payment plan
      </button>
    </div>
  );
}
