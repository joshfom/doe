"use client";

/**
 * InsertionButtonLayer — Puck `componentItem` override that wraps each
 * canvas-rendered component with insertion-button affordances.
 *
 * Spec: builder-outline-tree-and-toolbar (Task 4.1)
 * _Requirements: 4.1, 4.2, 4.3_
 *
 * The override is invoked once per rendered block in a zone. It receives the
 * block's `children` (the rendered component), the component's type `name`,
 * its `index` within the zone, and the `zone` compound key. We render:
 *
 *   - An `InsertionButton` BEFORE the first block (i.e. only when
 *     `index === 0`) so the slot above the leading sibling is reachable.
 *   - The original `children` (the rendered component) — we never touch the
 *     component itself; the wrapper is purely additive.
 *   - An `InsertionButton` AFTER every block, so the slot below each block is
 *     reachable.
 *
 * That layout produces exactly N + 1 insertion buttons for a zone of N
 * components, matching Property 4 (and Reqs 4.1, 4.2, 4.3):
 *
 *   button(0) [block(0)] button(1) [block(1)] button(2) ... button(N-1) [block(N-1)] button(N)
 *
 * The empty-zone case (Req 4.3, "single Insertion_Button as a placeholder")
 * is NOT this file's concern — when N = 0 the override is never invoked
 * because there are no blocks to wrap. The empty-zone placeholder is handled
 * by the BuilderShell wiring (task 8.x) which renders a standalone
 * `InsertionButton` inside any zone whose content array is empty.
 *
 * ─── Adjacent-label resolution ──────────────────────────────────────────────
 *
 * Each `InsertionButton` carries an `afterLabel` (the block ABOVE the slot,
 * if any) and a `beforeLabel` (the block BELOW the slot, if any) for the
 * accessible name. We derive them from the zone's content array read via
 * `usePuckStore` so they always match what the editor actually sees, and so
 * any per-instance `props._label` override is honoured. The label resolution
 * mirrors the convention used by `SelectedElementHeader`,
 * `SelectionLiveRegion`, and `page-tree.ts#resolveLabel` (instance `_label`
 * → registered config label → component type name) so the outline tree and
 * the insertion buttons cannot drift.
 *
 * ─── Override signature compatibility ───────────────────────────────────────
 *
 * Puck's `overrides.componentItem` is typed as
 * `RenderFunc<{ children: ReactNode; name: string }>`. The design pairs this
 * override with shell-level wiring (task 8.1) that supplies the additional
 * `index` and `zone` fields the wrapper needs to position buttons. When those
 * fields are absent — for example if the override is reused by a Puck code
 * path that doesn't carry positional metadata — the wrapper degrades to an
 * identity function so existing call sites keep working without surprises.
 */

import React from "react";
import { usePuckStore } from "../use-puck-store";
import { InsertionButton } from "./InsertionButton";
import { useInsertion } from "./InsertionContext";
import { HoverActionOverlay } from "./HoverActionOverlay";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Puck's root zone compound key — used to look up the root content array. */
const ROOT_ZONE = "root:default-zone";

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * Props the override receives. The first two (`children`, `name`) match
 * Puck's native `componentItem` signature; `index` and `zone` are augmented
 * by the BuilderShell wiring (task 8.1) so the wrapper can position
 * insertion buttons at the correct slot. Both are optional in the type so
 * the function remains assignable to Puck's `RenderFunc<{ children, name }>`
 * even if future call sites omit them.
 */
export interface ComponentItemOverrideProps {
  /** The rendered component output produced by Puck. */
  children: React.ReactNode;
  /** Component type name (e.g. "Heading"). Reserved for diagnostics. */
  name: string;
  /** Position of this block within its zone (0-indexed). */
  index?: number;
  /** Zone compound key (e.g. "root:default-zone" or "section-1:content"). */
  zone?: string;
}

// ─── Internal: label resolution ──────────────────────────────────────────────

type ComponentRecord = {
  type: string;
  props: Record<string, unknown>;
};

type ComponentLabelConfig =
  | {
      components?: Record<string, { label?: unknown } | undefined>;
    }
  | undefined;

/**
 * Resolve the human-readable label for a block. Identical priority order to
 * `page-tree.ts#resolveLabel` and `SelectedElementHeader#label` so all three
 * surfaces address the same block by the same name:
 *
 *   1. `props._label` if it's a non-empty string (per-instance override)
 *   2. `config.components[type].label` if it's a non-empty string
 *   3. The component type name as the final fallback
 */
function resolveLabel(
  item: ComponentRecord | undefined,
  config: ComponentLabelConfig,
): string | null {
  if (!item) return null;
  const instanceLabel = item.props?._label;
  if (typeof instanceLabel === "string" && instanceLabel.length > 0) {
    return instanceLabel;
  }
  const registeredLabel = config?.components?.[item.type]?.label;
  if (typeof registeredLabel === "string" && registeredLabel.length > 0) {
    return registeredLabel;
  }
  return item.type;
}

// ─── Internal: per-item wrapper ──────────────────────────────────────────────

/**
 * Renders the actual buttons + children layout for one block. Split out as a
 * component so we can call hooks (`usePuckStore`, `useInsertion`) only inside
 * the branch where we have a valid `index` + `zone` — the top-level override
 * function is a plain function without hook calls, which keeps it safe to
 * invoke from any Puck code path.
 */
function ComponentItemWrapper({
  children,
  index,
  zone,
}: {
  children: React.ReactNode;
  index: number;
  zone: string;
}): React.ReactElement {
  // Subscribe to the slices we need. Selecting individual slices keeps the
  // wrapper from re-rendering on unrelated state changes (e.g. selection).
  const data = usePuckStore((s) => s.appState.data);
  const config = usePuckStore((s) => s.config);
  const { openPicker } = useInsertion();

  // Resolve the zone's content array. The root zone lives on `data.content`;
  // every other zone lives on `data.zones[compound]`. Missing entries are
  // treated as empty so the wrapper degrades gracefully.
  const items = React.useMemo<ComponentRecord[]>(() => {
    if (zone === ROOT_ZONE) {
      return (data.content ?? []) as ComponentRecord[];
    }
    return (data.zones?.[zone] ?? []) as ComponentRecord[];
  }, [data, zone]);

  // Resolve the labels for the blocks adjacent to the two button positions
  // (before the current block and after the current block). The "before"
  // button only renders when `index === 0`, so its `afterLabel` is always
  // null — but we compute it explicitly for symmetry with the design rather
  // than hard-coding the empty case.
  const labels = React.useMemo(() => {
    const previousBlock = items[index - 1];
    const currentBlock = items[index];
    const nextBlock = items[index + 1];
    return {
      // "before" button = the slot ABOVE the current block (position `index`).
      // It sits between the previous block and the current block.
      beforeAfterLabel: resolveLabel(previousBlock, config),
      beforeBeforeLabel: resolveLabel(currentBlock, config),
      // "after" button = the slot BELOW the current block (position `index + 1`).
      // It sits between the current block and the next block.
      afterAfterLabel: resolveLabel(currentBlock, config),
      afterBeforeLabel: resolveLabel(nextBlock, config),
    };
  }, [items, index, config]);

  // Resolve the current block's label for the hover overlay aria-label.
  const currentBlockLabel = labels.afterAfterLabel ?? "Component";

  return (
    <>
      {/* Leading button — only the first block emits one, so the next block's
          "before" position is covered by the previous block's "after" button.
          This keeps the total count at exactly N + 1 (Property 4). */}
      {index === 0 ? (
        <InsertionButton
          zone={zone}
          index={0}
          afterLabel={labels.beforeAfterLabel}
          beforeLabel={labels.beforeBeforeLabel}
          onActivate={openPicker}
        />
      ) : null}

      {/* The rendered component wrapped with a hover action overlay so
          non-technical users can discover delete/select without clicking
          the block first. */}
      <HoverActionOverlay
        zone={zone}
        index={index}
        label={currentBlockLabel}
      >
        {children}
      </HoverActionOverlay>

      {/* Trailing button — every block emits one. The last block's trailing
          button is the zone's "append at end" affordance. */}
      <InsertionButton
        zone={zone}
        index={index + 1}
        afterLabel={labels.afterAfterLabel}
        beforeLabel={labels.afterBeforeLabel}
        onActivate={openPicker}
      />
    </>
  );
}

// ─── Public override entry point ─────────────────────────────────────────────

/**
 * Puck override entry point. Compatible with `overrides.componentItem`'s
 * `{ children, name }` signature and additionally consumes the BuilderShell-
 * augmented `{ index, zone }` payload to position insertion buttons within
 * the zone. When `index` or `zone` is missing — which can happen if the
 * override is invoked from a Puck code path that doesn't have positional
 * metadata — the children render unchanged (identity behaviour) so we never
 * accidentally hide content.
 */
export function componentItemOverride(
  props: ComponentItemOverrideProps,
): React.ReactElement {
  const { children, index, zone } = props;
  if (typeof index !== "number" || typeof zone !== "string") {
    return <>{children}</>;
  }
  return (
    <ComponentItemWrapper index={index} zone={zone}>
      {children}
    </ComponentItemWrapper>
  );
}
