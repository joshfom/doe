"use client";

/**
 * SaveToLibraryDialog — centered modal for saving selected components to the
 * Component Library.
 *
 * Spec: builder-template-component-library — task 6
 * Requirements: R4.1, R4.2, R4.3, R4.4, R4.5, R4.6, R4.7, R4.8, R4.9
 *
 * Design:
 *   - Centered modal (not a sheet) with backdrop (rgba(0,0,0,0.5)).
 *   - Portal to `document.body`.
 *   - Form fields: name (required, max 100), description (optional, max 500),
 *     category select (Global/Content, default Content).
 *   - Validation: non-empty name (trim whitespace) before allowing submit.
 *   - On submit: check for duplicate name via `componentLibrary.findByName()`.
 *     If exists, show overwrite confirmation.
 *   - Serialize selected component tree (content + zones) into a LibraryComponent
 *     record and call `componentLibrary.save()` to persist.
 *   - Show success confirmation on save.
 *   - On failure: show error message, preserve form state for retry.
 *   - Cancel button closes dialog, returns focus to trigger.
 *   - Focus trap (Tab/Shift+Tab cycle within dialog).
 *   - ESC-to-close with focus return to trigger.
 *   - Body scroll lock while open.
 *   - role="dialog", aria-modal="true", aria-label="Save to Library".
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { componentLibrary } from "../store";
import { ORA_THEME } from "./inspector/tokens";
import type { ComponentInstance } from "../types";

export interface SaveToLibraryDialogProps {
  open: boolean;
  onClose: () => void;
  /** The selected component instances to save. */
  selectedContent: ComponentInstance[];
  /** Zones belonging to the selected components. */
  selectedZones: Record<string, ComponentInstance[]>;
}

const FOCUSABLE_SELECTORS =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DialogView = "form" | "overwrite-confirm" | "success";

export function SaveToLibraryDialog({
  open,
  onClose,
  selectedContent,
  selectedZones,
}: SaveToLibraryDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"global" | "content">("content");

  // UI state
  const [view, setView] = useState<DialogView>("form");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [existingComponentId, setExistingComponentId] = useState<string | null>(null);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setCategory("content");
      setView("form");
      setNameError(null);
      setSaveError(null);
      setExistingComponentId(null);
    }
  }, [open]);

  // Focus trap, ESC-to-close, body scroll lock
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        FOCUSABLE_SELECTORS
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);

    // Focus first focusable inside the dialog on next frame
    const id = window.requestAnimationFrame(() => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        FOCUSABLE_SELECTORS
      );
      first?.focus();
    });

    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(id);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  const validateName = useCallback((): boolean => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("A non-empty name is required.");
      return false;
    }
    if (trimmed.length > 100) {
      setNameError("Name must be 100 characters or fewer.");
      return false;
    }
    setNameError(null);
    return true;
  }, [name]);

  const handleSubmit = useCallback(() => {
    if (!validateName()) return;
    setSaveError(null);

    const trimmedName = name.trim();

    // Check for duplicate name in user scope
    const existing = componentLibrary.findByName(trimmedName, "user");
    if (existing) {
      setExistingComponentId(existing.id);
      setView("overwrite-confirm");
      return;
    }

    // Save new component
    performSave();
  }, [name, validateName]);

  const performSave = useCallback(() => {
    try {
      const trimmedName = name.trim();
      componentLibrary.save({
        name: trimmedName,
        description: description.trim(),
        category,
        scope: "user",
        thumbnail: null,
        content: selectedContent,
        zones: selectedZones,
      });
      setView("success");
      // Auto-dismiss after 1.5s
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : "Failed to save component. Please try again."
      );
      setView("form");
    }
  }, [name, description, category, selectedContent, selectedZones, onClose]);

  const handleOverwrite = useCallback(() => {
    try {
      if (!existingComponentId) return;
      componentLibrary.update(existingComponentId, {
        name: name.trim(),
        description: description.trim(),
        category,
        content: selectedContent,
        zones: selectedZones,
        thumbnail: null,
      });
      setView("success");
      // Auto-dismiss after 1.5s
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : "Failed to overwrite component. Please try again."
      );
      setView("form");
      setExistingComponentId(null);
    }
  }, [existingComponentId, name, description, category, selectedContent, selectedZones, onClose]);

  const handleCancelOverwrite = useCallback(() => {
    setView("form");
    setExistingComponentId(null);
  }, []);

  if (typeof document === "undefined") return null;
  if (!open) return null;

  return createPortal(
    <div
      data-testid="save-to-library-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Save to Library"
        data-testid="save-to-library-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: ORA_THEME.white,
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
          fontFamily: "system-ui, sans-serif",
          overflow: "hidden",
        }}
      >
        {view === "success" ? (
          <SuccessView />
        ) : view === "overwrite-confirm" ? (
          <OverwriteConfirmView
            name={name.trim()}
            onOverwrite={handleOverwrite}
            onCancel={handleCancelOverwrite}
          />
        ) : (
          <FormView
            name={name}
            description={description}
            category={category}
            nameError={nameError}
            saveError={saveError}
            onNameChange={setName}
            onDescriptionChange={setDescription}
            onCategoryChange={setCategory}
            onSubmit={handleSubmit}
            onCancel={onClose}
          />
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── FormView ────────────────────────────────────────────────────────────────

interface FormViewProps {
  name: string;
  description: string;
  category: "global" | "content";
  nameError: string | null;
  saveError: string | null;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCategoryChange: (value: "global" | "content") => void;
  onSubmit: () => void;
  onCancel: () => void;
}

function FormView({
  name,
  description,
  category,
  nameError,
  saveError,
  onNameChange,
  onDescriptionChange,
  onCategoryChange,
  onSubmit,
  onCancel,
}: FormViewProps) {
  return (
    <>
      {/* Header */}
      <div
        style={{
          padding: "20px 24px 0",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: ORA_THEME.charcoal,
          }}
        >
          Save to Library
        </h2>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            color: ORA_THEME.muted,
            lineHeight: 1.4,
          }}
        >
          Save this component to your library for reuse.
        </p>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 24px" }}>
        {/* Save error */}
        {saveError && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              background: "#FDF2F2",
              border: `1px solid ${ORA_THEME.danger}`,
              borderRadius: 6,
              color: ORA_THEME.danger,
              fontSize: 13,
              lineHeight: 1.4,
            }}
          >
            {saveError}
          </div>
        )}

        {/* Name field */}
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="save-lib-name"
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              color: ORA_THEME.charcoal,
              marginBottom: 6,
            }}
          >
            Name <span style={{ color: ORA_THEME.danger }}>*</span>
          </label>
          <input
            id="save-lib-name"
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            maxLength={100}
            placeholder="e.g. Hero Section"
            aria-required="true"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? "save-lib-name-error" : undefined}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              border: `1px solid ${nameError ? ORA_THEME.danger : ORA_THEME.border}`,
              borderRadius: 6,
              background: ORA_THEME.white,
              color: ORA_THEME.charcoal,
              outline: "none",
              boxSizing: "border-box",
              transition: "border-color 150ms ease",
            }}
          />
          {nameError && (
            <p
              id="save-lib-name-error"
              role="alert"
              style={{
                margin: "4px 0 0",
                fontSize: 12,
                color: ORA_THEME.danger,
              }}
            >
              {nameError}
            </p>
          )}
        </div>

        {/* Description field */}
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="save-lib-description"
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              color: ORA_THEME.charcoal,
              marginBottom: 6,
            }}
          >
            Description
          </label>
          <textarea
            id="save-lib-description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            maxLength={500}
            placeholder="Optional description…"
            rows={3}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              border: `1px solid ${ORA_THEME.border}`,
              borderRadius: 6,
              background: ORA_THEME.white,
              color: ORA_THEME.charcoal,
              outline: "none",
              boxSizing: "border-box",
              resize: "vertical",
              fontFamily: "system-ui, sans-serif",
            }}
          />
        </div>

        {/* Category select */}
        <div style={{ marginBottom: 0 }}>
          <label
            htmlFor="save-lib-category"
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 500,
              color: ORA_THEME.charcoal,
              marginBottom: 6,
            }}
          >
            Category
          </label>
          <select
            id="save-lib-category"
            value={category}
            onChange={(e) =>
              onCategoryChange(e.target.value as "global" | "content")
            }
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              border: `1px solid ${ORA_THEME.border}`,
              borderRadius: 6,
              background: ORA_THEME.white,
              color: ORA_THEME.charcoal,
              outline: "none",
              boxSizing: "border-box",
              cursor: "pointer",
            }}
          >
            <option value="content">Content</option>
            <option value="global">Global</option>
          </select>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "16px 24px",
          borderTop: `1px solid ${ORA_THEME.border}`,
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "9px 18px",
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
          onClick={onSubmit}
          style={{
            padding: "9px 18px",
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
          Save
        </button>
      </div>
    </>
  );
}

// ─── OverwriteConfirmView ────────────────────────────────────────────────────

interface OverwriteConfirmViewProps {
  name: string;
  onOverwrite: () => void;
  onCancel: () => void;
}

function OverwriteConfirmView({
  name,
  onOverwrite,
  onCancel,
}: OverwriteConfirmViewProps) {
  return (
    <div style={{ padding: 24 }}>
      <h2
        style={{
          margin: 0,
          fontSize: 16,
          fontWeight: 600,
          color: ORA_THEME.charcoal,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Overwrite existing component?
      </h2>
      <p
        style={{
          margin: "12px 0 20px",
          fontSize: 14,
          color: ORA_THEME.muted,
          lineHeight: 1.5,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        A component named <strong>&ldquo;{name}&rdquo;</strong> already exists.
        Overwrite it with the new content?
      </p>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "9px 18px",
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
          onClick={onOverwrite}
          style={{
            padding: "9px 18px",
            fontSize: 13,
            fontWeight: 500,
            fontFamily: "system-ui, sans-serif",
            border: "none",
            borderRadius: 6,
            background: ORA_THEME.danger,
            color: ORA_THEME.white,
            cursor: "pointer",
          }}
        >
          Overwrite
        </button>
      </div>
    </div>
  );
}

// ─── SuccessView ─────────────────────────────────────────────────────────────

function SuccessView() {
  return (
    <div
      role="status"
      style={{
        padding: "40px 24px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          background: "#E8F5E9",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 12,
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#2E7D32"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 15,
          fontWeight: 500,
          color: ORA_THEME.charcoal,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Component saved to library!
      </p>
    </div>
  );
}
