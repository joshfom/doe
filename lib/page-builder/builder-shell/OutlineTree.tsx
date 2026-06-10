/**
 * OutlineTree — WAI-ARIA tree component for the left rail.
 *
 * Spec: builder-canvas-polish-and-inline-richtext
 * _Requirements: 8.1–8.9, 10.1_
 *
 * Renders the full page hierarchy as a keyboard-navigable tree.
 * Each node shows the block's Block_Label (never an ID).
 * Selecting a node dispatches `onSelect` with the block's PuckSelector.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { PageTree, PageTreeNode, PuckSelector } from "./page-tree";
import { ORA_THEME } from "./inspector/tokens";
import { useSelectionAnnounce } from "./SelectionLiveRegion";

export interface OutlineTreeProps {
  tree: PageTree;
  selectedId: string | null;
  onSelect: (selector: PuckSelector | null, id: string | null) => void;
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface FlatItem {
  node: PageTreeNode;
  level: number;
  posInSet: number;
  setSize: number;
  zoneName: string | null; // zone header label (null for root zone items)
  parentZoneKey: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function OutlineTree({ tree, selectedId, onSelect }: OutlineTreeProps) {
  const announce = useSelectionAnnounce();

  // Track which nodes are expanded (default: all expanded).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  // Roving tabindex: track which item currently has tabIndex=0.
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Refs for scrolling selected node into view.
  const itemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const treeRef = useRef<HTMLUListElement>(null);

  // ─── Flatten tree into visible items ─────────────────────────────────────

  const flatItems = useMemo(() => {
    const items: FlatItem[] = [];

    function walkNodes(
      nodes: PageTreeNode[],
      level: number,
      zoneName: string | null,
      parentZoneKey: string,
    ) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        items.push({
          node,
          level,
          posInSet: i + 1,
          setSize: nodes.length,
          zoneName: i === 0 ? zoneName : null, // only first item in zone gets the header
          parentZoneKey,
        });

        // If expanded, walk children by zone.
        if (!collapsed.has(node.id)) {
          const zoneEntries = Object.entries(node.childrenByZone);
          for (const [zName, children] of zoneEntries) {
            if (children.length > 0) {
              walkNodes(children, level + 1, zName, `${node.id}:${zName}`);
            }
          }
        }
      }
    }

    walkNodes(tree.roots, 1, null, "root:default-zone");
    return items;
  }, [tree, collapsed]);

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const hasChildren = useCallback(
    (node: PageTreeNode): boolean => {
      return Object.values(node.childrenByZone).some((c) => c.length > 0);
    },
    [],
  );

  const isExpanded = useCallback(
    (nodeId: string): boolean => !collapsed.has(nodeId),
    [collapsed],
  );

  const toggleExpand = useCallback((nodeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // ─── Scroll selected into view ──────────────────────────────────────────

  useEffect(() => {
    if (selectedId == null) return;
    const el = itemRefs.current.get(selectedId);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedId]);

  // ─── Keyboard navigation ────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = flatItems.findIndex((item) => item.node.id === focusedId);
      if (currentIndex === -1) return;

      const currentItem = flatItems[currentIndex];

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nextIndex = currentIndex + 1;
          if (nextIndex < flatItems.length) {
            setFocusedId(flatItems[nextIndex].node.id);
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prevIndex = currentIndex - 1;
          if (prevIndex >= 0) {
            setFocusedId(flatItems[prevIndex].node.id);
          }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (hasChildren(currentItem.node)) {
            if (!isExpanded(currentItem.node.id)) {
              // Expand
              toggleExpand(currentItem.node.id);
            } else {
              // Already expanded — move to first child
              const nextIndex = currentIndex + 1;
              if (nextIndex < flatItems.length) {
                setFocusedId(flatItems[nextIndex].node.id);
              }
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (hasChildren(currentItem.node) && isExpanded(currentItem.node.id)) {
            // Collapse
            toggleExpand(currentItem.node.id);
          } else {
            // Move to parent
            const parentId = currentItem.node.parentId;
            if (parentId) {
              setFocusedId(parentId);
            }
          }
          break;
        }
        case "Enter": {
          e.preventDefault();
          onSelect({ zone: currentItem.node.zone, index: currentItem.node.index }, currentItem.node.id);
          announce(currentItem.node.label);
          break;
        }
      }
    },
    [flatItems, focusedId, hasChildren, isExpanded, toggleExpand, onSelect],
  );

  // ─── Focus management ───────────────────────────────────────────────────

  useEffect(() => {
    if (focusedId == null) return;
    const el = itemRefs.current.get(focusedId);
    if (el) {
      el.focus();
    }
  }, [focusedId]);

  // Initialize focusedId to the first item if not set.
  useEffect(() => {
    if (focusedId == null && flatItems.length > 0) {
      setFocusedId(flatItems[0].node.id);
    }
  }, [flatItems, focusedId]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        maxWidth: 280,
        overflowY: "auto",
        height: "100%",
      }}
    >
      <ul
        ref={treeRef}
        role="tree"
        aria-label="Page outline"
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
        }}
        onKeyDown={handleKeyDown}
      >
        {flatItems.map((item) => {
          const nodeHasChildren = hasChildren(item.node);
          const expanded = isExpanded(item.node.id);
          const isSelected = item.node.id === selectedId;
          const isFocused = item.node.id === focusedId;

          return (
            <React.Fragment key={item.node.id}>
              {/* Zone header label */}
              {item.zoneName != null && (
                <li
                  role="presentation"
                  style={{
                    paddingLeft: (item.level - 1) * 16 + 8,
                    paddingTop: 6,
                    paddingBottom: 2,
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    color: ORA_THEME.muted,
                    userSelect: "none",
                  }}
                >
                  {item.zoneName}
                </li>
              )}
              <li
                ref={(el) => {
                  if (el) {
                    itemRefs.current.set(item.node.id, el);
                  } else {
                    itemRefs.current.delete(item.node.id);
                  }
                }}
                role="treeitem"
                aria-level={item.level}
                aria-posinset={item.posInSet}
                aria-setsize={item.setSize}
                aria-selected={isSelected}
                aria-expanded={nodeHasChildren ? expanded : undefined}
                tabIndex={isFocused ? 0 : -1}
                onClick={() => {
                  setFocusedId(item.node.id);
                  onSelect({ zone: item.node.zone, index: item.node.index }, item.node.id);
                  announce(item.node.label);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: (item.level - 1) * 16 + 8,
                  paddingRight: 8,
                  paddingTop: 4,
                  paddingBottom: 4,
                  cursor: "pointer",
                  borderRadius: 4,
                  background: isSelected ? ORA_THEME.cream : "transparent",
                  outline: "none",
                }}
              >
                {/* Disclosure chevron */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    transition: "transform 120ms ease",
                    transform: nodeHasChildren && expanded ? "rotate(90deg)" : "rotate(0deg)",
                    visibility: nodeHasChildren ? "visible" : "hidden",
                  }}
                  onClick={(e) => {
                    if (nodeHasChildren) {
                      e.stopPropagation();
                      toggleExpand(item.node.id);
                    }
                  }}
                  aria-hidden="true"
                >
                  <ChevronRight size={12} />
                </span>

                {/* Block label */}
                <span
                  style={{
                    marginLeft: 4,
                    fontSize: 13,
                    lineHeight: "20px",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: isSelected ? ORA_THEME.charcoal : ORA_THEME.charcoalDark,
                    fontWeight: isSelected ? 500 : 400,
                  }}
                >
                  {item.node.label}
                </span>
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </div>
  );
}
