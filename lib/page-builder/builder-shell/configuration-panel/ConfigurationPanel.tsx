"use client";

/**
 * ConfigurationPanel — right-side ORA-themed panel that replaces Puck's
 * default field sidebar in the BuilderShell.
 *
 * Spec: custom-branded-page-builder — Requirements 3.1, 3.2, 3.5
 *
 * This is the shell-level component for task 3.1. It renders exactly three
 * tabs in this order: `Configurations`, `Style`, `Theme`. Field routing
 * reuses the existing classifier in `../inspector/sections.ts` so we do not
 * duplicate classification logic — the classifier emits four buckets
 * (Content / Style / Layout / Advanced) which we map onto the three
 * customer-facing tabs like this:
 *
 *   - Configurations ← Content + Advanced  (block settings & semantics)
 *   - Style          ← Style               (colors, typography, alignment)
 *   - Theme          ← Layout              (spacing, sizing, position)
 *
 * The Theme tab owning layout fields matches the ORA design intent: padding,
 * margin, width, and height are theming decisions driven by breakpoints in
 * slice 3. If/when the classifier grows a fifth bucket, this map is the one
 * place to update the routing.
 *
 * Active tab state lives in the module-scoped `tab-store` so switches
 * survive selection changes and preserve scroll/focus across re-renders
 * (Requirement 3.3).
 *
 * When no block is selected, the `Configurations` tab renders page-level
 * settings (slug/title/SEO) via `PageSettingsFields`. The other two tabs
 * show an empty-state hint — page-level style/theme editing is a later
 * concern.
 */

import React, { useMemo } from "react";
import { usePuckStore } from "../../use-puck-store";
import type { Field } from "@puckeditor/core";
import { FieldControlRegistry } from "./FieldControlRegistry";
import { ResponsiveDefaultsProvider } from "./BreakpointAwareFieldWrapper";
import {
  classifyField,
  type InspectorSection,
} from "../inspector/sections";
import { ORA_THEME } from "../inspector/tokens";
import { isRichtextField } from "../richtext-fields";
import { PageSettingsFields } from "./PageSettingsFields";
import { useTabStore } from "./tab-store";
import { VisibilitySection } from "./VisibilitySection";
import { AncestorBreadcrumb } from "../AncestorBreadcrumb";
import { buildPageTree, buildAncestorPath } from "../page-tree";
import type { PuckSelector } from "../page-tree";
import { useSelectionAnnounce } from "../SelectionLiveRegion";

export type ConfigurationTab = "configurations" | "style" | "theme";

interface TabDef {
  id: ConfigurationTab;
  label: string;
}

const TABS: ReadonlyArray<TabDef> = [
  { id: "configurations", label: "Configurations" },
  { id: "style", label: "Style" },
  { id: "theme", label: "Theme" },
];

/**
 * Map a classifier output to the customer-facing tab that owns it.
 * Exported so downstream code (e.g. section-store key derivation in task 3.2)
 * can share the exact same mapping.
 */
export function sectionToTab(section: InspectorSection): ConfigurationTab {
  switch (section) {
    case "Style":
      return "style";
    case "Layout":
      return "theme";
    case "Content":
    case "Advanced":
    default:
      return "configurations";
  }
}

export interface ConfigurationPanelProps {
  /**
   * Optional slug for the page-level `Configurations` tab when no block is
   * selected. Passed through from the shell because the slug lives on the
   * DocumentRecord and not on Puck state.
   */
  pageSlug?: string;
}

export function ConfigurationPanel({ pageSlug }: ConfigurationPanelProps = {}) {
  const selectedItem = usePuckStore((s) => s.selectedItem);
  const config = usePuckStore((s) => s.config);
  const dispatch = usePuckStore((s) => s.dispatch);
  const getSelectorForId = usePuckStore((s) => s.getSelectorForId);

  // Tab state lives in the module-scoped `tab-store` so it survives
  // selection changes and preserves scroll/focus across re-renders
  // (Requirement 3.3).
  const { activeTab, setActiveTab } = useTabStore();

  const componentType = selectedItem?.type;
  const componentConfig = componentType
    ? config.components?.[componentType]
    : undefined;
  const fields = componentConfig?.fields as
    | Record<string, Field>
    | undefined;
  const props = (selectedItem?.props ?? {}) as Record<string, unknown>;

  // Group the selected block's fields into the three customer-facing tabs,
  // reusing the existing classifier. `id` is skipped because it's internal.
  const fieldsByTab: Record<ConfigurationTab, Array<[string, Field]>> = {
    configurations: [],
    style: [],
    theme: [],
  };

  if (fields) {
    for (const [name, field] of Object.entries(fields)) {
      if (name === "id") continue;
      if (!field) continue;
      if (field.visible === false) continue;
      if (isRichtextField(name)) continue;
      fieldsByTab[sectionToTab(classifyField(name))].push([name, field]);
    }
  }

  const updateProp = React.useCallback(
    (propName: string, value: unknown) => {
      if (!selectedItem) return;
      const selector = getSelectorForId(selectedItem.props.id as string);
      if (!selector) return;
      dispatch({
        type: "replace",
        destinationZone: selector.zone,
        destinationIndex: selector.index,
        data: {
          ...selectedItem,
          props: { ...selectedItem.props, [propName]: value },
        },
      });
    },
    [dispatch, getSelectorForId, selectedItem],
  );

  return (
    <aside
      style={panelStyle}
      data-testid="ora-configuration-panel"
      aria-label="Configuration panel"
    >
      <Header selected={selectedItem} />
      <TabList activeTab={activeTab} onChange={setActiveTab} />
      <div
        role="tabpanel"
        id={`ora-config-panel-${activeTab}`}
        aria-labelledby={`ora-config-tab-${activeTab}`}
        style={{ flex: 1, overflowY: "auto", padding: 12 }}
      >
        {selectedItem ? (
          <BlockTabContent
            tab={activeTab}
            blockType={selectedItem.type}
            fields={fieldsByTab[activeTab]}
            values={props}
            onFieldChange={updateProp}
            responsiveDefaults={(componentConfig as any)?.responsiveDefaults}
          />
        ) : (
          <PageTabContent tab={activeTab} pageSlug={pageSlug} />
        )}
      </div>
    </aside>
  );
}

function Header({
  selected,
}: {
  selected: { type: string; props: Record<string, unknown> } | null;
}) {
  const appState = usePuckStore((s) => s.appState);
  const config = usePuckStore((s) => s.config);
  const dispatch = usePuckStore((s) => s.dispatch);
  const announce = useSelectionAnnounce();

  const label = selected ? selected.type : "Page";
  const selectedId = selected ? (selected.props.id as string) : null;

  // Derive the page tree from current data, memoized on data reference.
  const tree = useMemo(
    () => buildPageTree(appState.data, config),
    [appState.data, config],
  );

  // Build ancestor path for the breadcrumb.
  const segments = useMemo(
    () => buildAncestorPath(tree, selectedId),
    [tree, selectedId],
  );

  const handleSelect = React.useCallback(
    (selector: PuckSelector | null, id: string | null) => {
      dispatch({
        type: "setUi",
        ui: { itemSelector: selector },
      });
      if (id) {
        const el = document.querySelector(`[data-puck-id="${id}"]`);
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
        }
        // Announce the newly selected block's label for assistive tech.
        const node = tree.byId.get(id);
        if (node) {
          announce(node.label);
        }
      } else {
        announce("Page");
      }
    },
    [dispatch, tree, announce],
  );

  return (
    <div
      style={{
        padding: "10px 12px",
        borderBottom: `1px solid ${ORA_THEME.border}`,
        background: ORA_THEME.white,
      }}
    >
      <div
        style={{ fontSize: 13, fontWeight: 600, color: ORA_THEME.charcoal }}
      >
        {label}
      </div>
      {selected && segments.length > 0 && (
        <div style={{ fontSize: 11, marginTop: 4, color: ORA_THEME.muted }}>
          <AncestorBreadcrumb
            segments={segments}
            includeSelf={false}
            onSelect={handleSelect}
          />
        </div>
      )}
    </div>
  );
}

function TabList({
  activeTab,
  onChange,
}: {
  activeTab: ConfigurationTab;
  onChange: (tab: ConfigurationTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Configuration tabs"
      style={{
        display: "flex",
        borderBottom: `1px solid ${ORA_THEME.border}`,
        background: ORA_THEME.creamLight,
      }}
    >
      {TABS.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            id={`ora-config-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`ora-config-panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              padding: "10px 12px",
              background: isActive ? ORA_THEME.white : "transparent",
              border: "none",
              borderBottom: isActive
                ? `2px solid ${ORA_THEME.gold}`
                : "2px solid transparent",
              borderRadius: 0,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 700,
              color: isActive ? ORA_THEME.charcoal : ORA_THEME.muted,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function BlockTabContent({
  tab,
  blockType,
  fields,
  values,
  onFieldChange,
  responsiveDefaults,
}: {
  tab: ConfigurationTab;
  blockType: string;
  fields: Array<[string, Field]>;
  values: Record<string, unknown>;
  onFieldChange: (name: string, value: unknown) => void;
  responsiveDefaults?: Record<string, unknown>;
}) {
  const showVisibility = tab === "configurations";
  if (fields.length === 0 && !showVisibility) {
    return <EmptyState message={emptyStateMessageForBlock(tab)} />;
  }
  return (
    <ResponsiveDefaultsProvider responsiveDefaults={responsiveDefaults as any}>
      {fields.length === 0 && showVisibility && (
        <EmptyState message={emptyStateMessageForBlock(tab)} />
      )}
      {fields.map(([name, field]) => (
        <FieldControlRegistry
          key={name}
          name={name}
          field={field}
          value={values[name]}
          onChange={(v) => onFieldChange(name, v)}
        />
      ))}
      {showVisibility ? (
        <VisibilitySection
          blockType={blockType}
          value={values._visibility}
          onChange={(next) => onFieldChange("_visibility", next)}
        />
      ) : null}
    </ResponsiveDefaultsProvider>
  );
}

function PageTabContent({
  tab,
  pageSlug,
}: {
  tab: ConfigurationTab;
  pageSlug?: string;
}) {
  if (tab === "configurations") {
    // Requirement 3.5: no-selection Configurations tab shows page-level settings
    return <PageSettingsFields slug={pageSlug} />;
  }
  return <EmptyState message={emptyStateMessageForPage(tab)} />;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ fontSize: 12, color: ORA_THEME.muted, padding: "8px 0" }}>
      {message}
    </div>
  );
}

function emptyStateMessageForBlock(tab: ConfigurationTab): string {
  switch (tab) {
    case "configurations":
      return "This block has no configuration fields.";
    case "style":
      return "This block has no style fields.";
    case "theme":
      return "This block has no theme fields.";
  }
}

function emptyStateMessageForPage(tab: ConfigurationTab): string {
  switch (tab) {
    case "style":
      return "Select a block to edit its style.";
    case "theme":
      return "Select a block to edit its theme.";
    case "configurations":
      // unreachable — configurations tab always renders page settings
      return "";
  }
}

const panelStyle: React.CSSProperties = {
  height: "100%",
  background: ORA_THEME.white,
  borderLeft: `1px solid ${ORA_THEME.border}`,
  display: "flex",
  flexDirection: "column",
  fontFamily: "system-ui, sans-serif",
};
