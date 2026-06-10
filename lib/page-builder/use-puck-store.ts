"use client";

/**
 * Typed `usePuck` hook created via `createUsePuck` with a mandatory selector.
 *
 * Using `usePuck()` without a selector subscribes to the entire Puck store and
 * causes unnecessary re-renders on every state change. `createUsePuck` returns
 * a hook that requires a selector, so each consumer only re-renders when the
 * slice it cares about actually changes.
 *
 * Usage:
 *   import { usePuckStore } from "@/lib/page-builder/use-puck-store";
 *   const selectedItem = usePuckStore((s) => s.selectedItem);
 */

import { createUsePuck } from "@puckeditor/core";
import type { Config } from "@puckeditor/core";

export const usePuckStore = createUsePuck<Config>();
