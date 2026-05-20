"use client";

/**
 * TemplateLibrarySheet — browsable template library overlay.
 *
 * Spec: builder-template-component-library — task 4
 * Requirements: R2.1, R2.2, R2.3, R2.4, R2.5, R2.6, R2.7, R2.8, R2.9
 *
 * Design:
 *   - Uses `LibrarySheet` as the container (portal, focus trap, ESC close).
 *   - Reads templates from `templateRegistry.list()`.
 *   - Renders cards in a responsive CSS Grid (auto-fill, minmax(280px, 1fr)).
 *   - Each card: thumbnail (16:9 aspect), name, description (truncated 120 chars).
 *   - Click card → inline confirmation prompt.
 *   - Confirm → dispatches Puck `setData` preserving root props.
 *   - Close sheet after successful import.
 *   - Error message if import fails, preserves existing page content.
 *   - Keyboard navigable: Tab through cards, Enter to select.
 */

import React, { useState, useCallback, useRef } from "react";
import { LibrarySheet } from "./LibrarySheet";
import { usePuckStore } from "../use-puck-store";
import { templateRegistry } from "../store";
import { migratePageData } from "../migrate-data";
import { ORA_THEME } from "./inspector/tokens";

export interface TemplateLibrarySheetProps {
  open: boolean;
  onClose: () => void;
}

/** Truncate text to maxLen characters with ellipsis. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "…";
}

export function TemplateLibrarySheet({ open, onClose }: TemplateLibrarySheetProps) {
  const dispatch = usePuckStore((s) => s.dispatch);
  const appState = usePuckStore((s) => s.appState);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const templates = React.useMemo(() => templateRegistry.list(), []);

  const handleCardClick = useCallback((templateId: string) => {
    setError(null);
    setSelectedTemplateId(templateId);
  }, []);

  const handleCancel = useCallback(() => {
    setSelectedTemplateId(null);
  }, []);

  const handleImport = useCallback(() => {
    const template = templates.find((t) => t.id === selectedTemplateId);
    if (!template) {
      setError("Template not found.");
      setSelectedTemplateId(null);
      return;
    }

    try {
      // Preserve existing root props (title, slug, SEO metadata)
      const currentRoot = appState.data.root;
      // Migrate template data from legacy DropZone format to slot format
      // before dispatching, so Puck's internal processing doesn't crash.
      const migratedData = migratePageData({
        ...template.data,
        root: {
          ...template.data.root,
          props: {
            ...template.data.root.props,
            ...currentRoot.props,
          },
        },
      });

      dispatch({
        type: "setData",
        data: migratedData,
      });
      setSelectedTemplateId(null);
      setError(null);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to import template. Please try again."
      );
      setSelectedTemplateId(null);
    }
  }, [selectedTemplateId, templates, dispatch, onClose, appState]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, templateId: string) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (selectedTemplateId === templateId) {
          // If already selected (confirmation showing), Enter confirms import
          handleImport();
        } else {
          handleCardClick(templateId);
        }
      }
    },
    [selectedTemplateId, handleCardClick, handleImport]
  );

  // Reset state when sheet closes
  React.useEffect(() => {
    if (!open) {
      setSelectedTemplateId(null);
      setError(null);
    }
  }, [open]);

  return (
    <LibrarySheet open={open} onClose={onClose} title="Templates">
      <div style={{ padding: 24 }}>
        {/* Error message */}
        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "12px 16px",
              background: "#FDF2F2",
              border: `1px solid ${ORA_THEME.danger}`,
              borderRadius: 6,
              color: ORA_THEME.danger,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}

        {/* Template grid */}
        {templates.length === 0 ? (
          <div
            role="status"
            style={{
              textAlign: "center",
              padding: "48px 24px",
              color: ORA_THEME.muted,
              fontSize: 14,
            }}
          >
            No templates available.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 20,
            }}
          >
            {templates.map((template) => {
              const isSelected = selectedTemplateId === template.id;
              return (
                <div
                  key={template.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(template.id, el);
                    else cardRefs.current.delete(template.id);
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Template: ${template.name}`}
                  aria-pressed={isSelected}
                  onClick={() => handleCardClick(template.id)}
                  onKeyDown={(e) => handleKeyDown(e, template.id)}
                  style={{
                    position: "relative",
                    borderRadius: 8,
                    border: isSelected
                      ? `2px solid ${ORA_THEME.gold}`
                      : `1px solid ${ORA_THEME.border}`,
                    background: ORA_THEME.white,
                    cursor: "pointer",
                    overflow: "hidden",
                    outline: "none",
                    transition: "border-color 150ms ease, box-shadow 150ms ease",
                    boxShadow: isSelected
                      ? `0 0 0 3px rgba(184, 149, 107, 0.2)`
                      : "0 1px 3px rgba(0,0,0,0.06)",
                  }}
                >
                  {/* Thumbnail (16:9 aspect ratio) */}
                  <div
                    style={{
                      width: "100%",
                      paddingTop: "56.25%", // 16:9 aspect ratio
                      position: "relative",
                      background: ORA_THEME.cream,
                      borderBottom: `1px solid ${ORA_THEME.border}`,
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: ORA_THEME.muted,
                        fontSize: 12,
                        fontFamily: "system-ui, sans-serif",
                      }}
                      aria-hidden="true"
                    >
                      {/* Placeholder thumbnail using thumbnailId */}
                      <svg
                        width="48"
                        height="48"
                        viewBox="0 0 48 48"
                        fill="none"
                        aria-hidden="true"
                      >
                        <rect
                          x="4"
                          y="8"
                          width="40"
                          height="32"
                          rx="3"
                          stroke={ORA_THEME.muted}
                          strokeWidth="1.5"
                          fill="none"
                        />
                        <path
                          d="M4 30l10-8 8 6 12-10 10 8"
                          stroke={ORA_THEME.gold}
                          strokeWidth="1.5"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle cx="14" cy="18" r="3" fill={ORA_THEME.gold} opacity="0.6" />
                      </svg>
                    </div>
                  </div>

                  {/* Card body */}
                  <div style={{ padding: "12px 16px 16px" }}>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 14,
                        fontWeight: 600,
                        color: ORA_THEME.charcoal,
                        fontFamily: "system-ui, sans-serif",
                        lineHeight: 1.3,
                      }}
                    >
                      {template.name}
                    </h3>
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontSize: 12,
                        lineHeight: 1.4,
                        color: ORA_THEME.muted,
                        fontFamily: "system-ui, sans-serif",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {truncate(template.description, 120)}
                    </p>
                  </div>

                  {/* Inline confirmation prompt */}
                  {isSelected && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(255, 255, 255, 0.95)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 20,
                        borderRadius: 8,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p
                        style={{
                          margin: "0 0 16px",
                          fontSize: 13,
                          fontWeight: 500,
                          color: ORA_THEME.charcoal,
                          textAlign: "center",
                          lineHeight: 1.4,
                          fontFamily: "system-ui, sans-serif",
                        }}
                      >
                        This will replace all page content.
                      </p>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancel();
                          }}
                          style={{
                            padding: "8px 16px",
                            fontSize: 13,
                            fontWeight: 500,
                            fontFamily: "system-ui, sans-serif",
                            border: `1px solid ${ORA_THEME.border}`,
                            borderRadius: 6,
                            background: ORA_THEME.white,
                            color: ORA_THEME.charcoal,
                            cursor: "pointer",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleImport();
                          }}
                          style={{
                            padding: "8px 16px",
                            fontSize: 13,
                            fontWeight: 500,
                            fontFamily: "system-ui, sans-serif",
                            border: "none",
                            borderRadius: 6,
                            background: ORA_THEME.gold,
                            color: ORA_THEME.white,
                            cursor: "pointer",
                          }}
                        >
                          Import
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </LibrarySheet>
  );
}
