"use client";

/**
 * LibraryContext — shared context for the "Save to Library" workflow.
 *
 * Spec: builder-template-component-library — task 7
 * Requirements: R4.1, R5.1
 *
 * This context is provided by BuilderShell and consumed by
 * SelectedElementHeader (and potentially other components) to trigger the
 * SaveToLibraryDialog without prop-drilling through the component tree.
 *
 * The context exposes a single `openSaveDialog` function that accepts the
 * selected component's content array and its associated zones. The provider
 * (BuilderShell) is responsible for managing the dialog open/close state
 * and rendering the SaveToLibraryDialog with the supplied data.
 */

import { createContext, useContext } from "react";
import type { ComponentInstance } from "../types";

export interface LibraryContextValue {
  /**
   * Opens the SaveToLibraryDialog with the given component content and zones.
   * Called from SelectedElementHeader when the user clicks "Save to Library".
   */
  openSaveDialog: (
    content: ComponentInstance[],
    zones: Record<string, ComponentInstance[]>,
  ) => void;
}

/**
 * Default no-op context value. Components consuming this context outside of
 * a provider will silently do nothing — this is intentional so the
 * SelectedElementHeader can render in contexts where the library feature
 * is not wired up (e.g., inline editor) without crashing.
 */
const defaultValue: LibraryContextValue = {
  openSaveDialog: () => {},
};

export const LibraryContext = createContext<LibraryContextValue>(defaultValue);

/**
 * Hook to consume the LibraryContext. Returns the `openSaveDialog` function
 * provided by BuilderShell.
 */
export function useLibrary(): LibraryContextValue {
  return useContext(LibraryContext);
}
