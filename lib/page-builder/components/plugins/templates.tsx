"use client";

import React, { useMemo, useState } from "react";
import { usePuckStore } from "../../use-puck-store";
import type { Plugin, Data } from "@puckeditor/core";
import { LayoutTemplate, Save } from "lucide-react";
import {
  componentTemplates as builtInTemplates,
  instantiate,
  type ComponentTemplate,
} from "../../templates/component-templates";
import {
  useComponentTemplates,
  useSaveComponentTemplate,
  useDeleteComponentTemplate,
  type ComponentTemplateRecord,
} from "../../../cms/hooks/use-component-templates";
import type { ComponentInstance, PageData } from "../../types";

// ─── Insert helpers ──────────────────────────────────────────────────────────

// Map a layout component type → the slot field name we should drop new content into.
// Components not in this map have no slot and templates can only be inserted
// **next to** them (in the parent zone), never inside them.
const PRIMARY_ZONE: Record<string, string> = {
  Section: "section-content",
  Container: "container-content",
  Columns: "column-0", // first column by default
  Accordion: "accordion-content",
};

interface InsertTarget {
  zone: string; // "" or undefined ⇒ root content
  index: number; // -1 ⇒ append
}

function mergeTemplate(
  prev: Data,
  template: ComponentTemplate,
  target: InsertTarget
): Data {
  const inst = instantiate(template);
  const prevData = prev as unknown as PageData;
  const prevZones = prevData.zones ?? {};
  const nextZones = { ...prevZones, ...inst.zones };

  // Root content insert
  if (!target.zone) {
    const content = [...prevData.content];
    if (target.index < 0 || target.index >= content.length) {
      content.push(...inst.content);
    } else {
      content.splice(target.index, 0, ...inst.content);
    }
    return { ...prevData, content, zones: nextZones } as unknown as Data;
  }

  // Zone insert — splice into existing zone (creating it if missing)
  const existing = prevZones[target.zone] ?? [];
  const merged =
    target.index < 0 || target.index >= existing.length
      ? [...existing, ...inst.content]
      : [
          ...existing.slice(0, target.index),
          ...inst.content,
          ...existing.slice(target.index),
        ];
  nextZones[target.zone] = merged;
  return { ...prevData, zones: nextZones } as unknown as Data;
}

// ─── Recursive descendant collector ──────────────────────────────────────────
//
// Given a root component instance and the page's full zones map, walk every
// `<id>:<zoneName>` descendant and return a fresh zones object containing
// only those zones (so the saved template is self-contained).

function collectDescendantZones(
  rootId: string,
  zones: Record<string, ComponentInstance[]>
): Record<string, ComponentInstance[]> {
  const result: Record<string, ComponentInstance[]> = {};
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const [zoneKey, items] of Object.entries(zones)) {
      const [ownerId] = zoneKey.split(":");
      if (ownerId !== id) continue;
      result[zoneKey] = items;
      for (const child of items) {
        if (child.props?.id) queue.push(child.props.id);
      }
    }
  }

  return result;
}

// ─── Templates Panel ─────────────────────────────────────────────────────────

function TemplatesPanel() {
  const dispatch = usePuckStore((s) => s.dispatch);
  const selectedItem = usePuckStore((s) => s.selectedItem);
  const getSelectorForId = usePuckStore((s) => s.getSelectorForId);
  const userTemplatesQuery = useComponentTemplates();
  const deleteMut = useDeleteComponentTemplate();
  const [tab, setTab] = useState<"builtin" | "saved">("builtin");

  // Resolve where a template should be dropped, based on current selection.
  // Priority:
  //   1. If a layout container is selected (Section/Container/Columns/Accordion)
  //      → insert INSIDE its primary zone (append).
  //   2. Else if anything is selected → insert AFTER it in its parent zone.
  //   3. Else → append to root content.
  const target: InsertTarget = useMemo(() => {
    if (!selectedItem) return { zone: "", index: -1 };
    const innerZoneName = PRIMARY_ZONE[selectedItem.type];
    if (innerZoneName) {
      return { zone: `${selectedItem.props.id}:${innerZoneName}`, index: -1 };
    }
    const sel = getSelectorForId(selectedItem.props.id);
    if (sel) {
      return { zone: sel.zone ?? "", index: sel.index + 1 };
    }
    return { zone: "", index: -1 };
  }, [selectedItem, getSelectorForId]);

  const targetLabel = useMemo(() => {
    if (!selectedItem) return "Page (root)";
    if (PRIMARY_ZONE[selectedItem.type]) return `Inside ${selectedItem.type}`;
    return `After ${selectedItem.type}`;
  }, [selectedItem]);

  const insert = (template: ComponentTemplate) => {
    dispatch({
      type: "setData",
      data: (prev) => mergeTemplate(prev as Data, template, target) as Partial<Data>,
    });
  };

  const userTemplates: ComponentTemplate[] = useMemo(
    () =>
      (userTemplatesQuery.data ?? []).map((row: ComponentTemplateRecord) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        scope: row.scope,
        thumbnail: row.thumbnail,
        content: row.content,
        zones: row.zones,
      })),
    [userTemplatesQuery.data]
  );

  const items = tab === "builtin" ? builtInTemplates : userTemplates;

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>Templates</h3>

      <div style={{ fontSize: 11, color: "#6B6B6B", background: "#F9F7F5", padding: "6px 8px", border: "1px solid #E8E4DF" }}>
        Insert target: <strong style={{ color: "#1A1A1A" }}>{targetLabel}</strong>
        <div style={{ marginTop: 2 }}>
          Tip: select a Section / Container / Columns / Accordion on the canvas
          first to drop the template inside it.
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #E8E4DF" }}>
        {(["builtin", "saved"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              border: "none",
              borderBottom: tab === t ? "2px solid #B8956B" : "2px solid transparent",
              background: "transparent",
              color: tab === t ? "#1A1A1A" : "#6B6B6B",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            {t === "builtin" ? "Built-in" : "Saved"}
          </button>
        ))}
      </div>

      {tab === "saved" && userTemplatesQuery.isLoading && (
        <div style={{ fontSize: 12, color: "#6B6B6B" }}>Loading…</div>
      )}
      {tab === "saved" && !userTemplatesQuery.isLoading && items.length === 0 && (
        <div style={{ fontSize: 12, color: "#6B6B6B" }}>
          No saved templates yet. Select a block in the canvas, then use
          <em> Save as Template</em> from its toolbar.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((tpl) => (
          <div
            key={tpl.id}
            style={{
              border: "1px solid #E8E4DF",
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{tpl.name}</strong>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  type="button"
                  onClick={() => insert(tpl)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    background: "#B8956B",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  Insert
                </button>
                {tab === "saved" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete template "${tpl.name}"?`)) {
                        deleteMut.mutate(tpl.id);
                      }
                    }}
                    aria-label={`Delete template ${tpl.name}`}
                    style={{
                      padding: "4px 8px",
                      fontSize: 12,
                      background: "transparent",
                      color: "#B85C5C",
                      border: "1px solid #E8E4DF",
                      cursor: "pointer",
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
            {tpl.description && (
              <div style={{ fontSize: 12, color: "#6B6B6B" }}>{tpl.description}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Save-as-Template Panel ──────────────────────────────────────────────────

function SaveAsTemplatePanel() {
  const selectedItem = usePuckStore((s) => s.selectedItem);
  const appState = usePuckStore((s) => s.appState);
  const saveMut = useSaveComponentTemplate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  if (!selectedItem) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: "#6B6B6B" }}>
        Select a block on the canvas to save it (and any nested children) as a
        re-usable template.
      </div>
    );
  }

  const rootId = selectedItem.props.id;
  const data = appState.data as unknown as PageData;
  const descendantZones = collectDescendantZones(rootId, data.zones ?? {});

  const handleSave = async () => {
    if (!name.trim()) {
      setFeedback("Name is required");
      return;
    }
    setFeedback(null);
    try {
      await saveMut.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        scope: "block",
        content: [selectedItem as unknown as ComponentInstance],
        zones: descendantZones,
      });
      setFeedback("Saved!");
      setName("");
      setDescription("");
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>Save as Template</h3>
      <div style={{ fontSize: 12, color: "#6B6B6B" }}>
        Selected: <strong>{selectedItem.type}</strong>
        {Object.keys(descendantZones).length > 0 && (
          <> (+{Object.keys(descendantZones).length} nested zones)</>
        )}
      </div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My custom block"
          style={{ padding: "6px 8px", border: "1px solid #E8E4DF", fontSize: 13 }}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
        Description
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          style={{ padding: "6px 8px", border: "1px solid #E8E4DF", fontSize: 13, resize: "vertical" }}
        />
      </label>
      <button
        type="button"
        onClick={handleSave}
        disabled={saveMut.isPending}
        style={{
          padding: "8px 12px",
          background: saveMut.isPending ? "#9A9A9A" : "#B8956B",
          color: "#fff",
          border: "none",
          fontSize: 13,
          fontWeight: 600,
          cursor: saveMut.isPending ? "not-allowed" : "pointer",
        }}
      >
        {saveMut.isPending ? "Saving…" : "Save Template"}
      </button>
      {feedback && (
        <div style={{ fontSize: 12, color: feedback === "Saved!" ? "#4A8B4A" : "#B85C5C" }}>
          {feedback}
        </div>
      )}
    </div>
  );
}

// ─── Plugin factories ────────────────────────────────────────────────────────

export function createTemplatesPlugin(): Plugin {
  return {
    name: "templates",
    label: "Templates",
    icon: React.createElement(LayoutTemplate, { size: 16 }),
    render: () => React.createElement(TemplatesPanel),
  };
}

export function createSaveAsTemplatePlugin(): Plugin {
  return {
    name: "save-as-template",
    label: "Save as Template",
    icon: React.createElement(Save, { size: 16 }),
    render: () => React.createElement(SaveAsTemplatePanel),
  };
}
