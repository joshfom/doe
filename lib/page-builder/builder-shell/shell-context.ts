"use client";

/**
 * BuilderShellContext — exposes shell-level handlers (save, publish, preview,
 * dirty flag, lastSavedAt, document title) to descendants like TopBar and
 * StatusBar that need them but live inside the <Puck> tree.
 */

import React from "react";

export interface BuilderShellContextValue {
  documentTitle: string;
  setDocumentTitle: (next: string) => void;
  dirty: boolean;
  lastSavedAt: string | null;
  saving: boolean;
  publishing: boolean;
  onSave: () => Promise<void>;
  onPublish: () => Promise<void>;
  onPreview: () => void;
  errorMessage: string | null;
  dismissError: () => void;
}

const BuilderShellContext = React.createContext<BuilderShellContextValue | null>(
  null,
);

export const BuilderShellProvider = BuilderShellContext.Provider;

export function useBuilderShell(): BuilderShellContextValue {
  const ctx = React.useContext(BuilderShellContext);
  if (!ctx) {
    throw new Error("useBuilderShell must be used inside <BuilderShellProvider>");
  }
  return ctx;
}
