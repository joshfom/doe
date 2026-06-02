"use client";

/**
 * Headless Puck overrides — every chrome slot returns null so the
 * Builder Shell owns 100% of the visible UI. The canvas is rendered
 * via `<Puck.Preview />` passed as `children` to `<Puck>`.
 *
 * NOTE: when children are provided to <Puck>, Puck skips its default
 * Layout entirely. These overrides are a belt-and-braces measure for
 * any slot that might still render (e.g., overlays, iframe).
 */

import React from "react";
import type { Overrides } from "@puckeditor/core";
import { componentItemOverride } from "./InsertionButtonLayer";
import { InlineRichtextActionBar } from "./InlineRichtextActionBar";

const renderNull = () => <></> as unknown as React.ReactElement;

export const headlessOverrides: Partial<Overrides> = {
  header: renderNull,
  headerActions: renderNull,
  // The Builder Shell renders move/duplicate/delete via its own
  // `SelectedElementHeader`, so we do NOT want Puck's default action bar.
  // BUT Puck passes the native inline rich-text menu (the floating
  // formatting bubble) as `children` of this same `actionBar` slot whenever
  // a block's inline rich-text editor is focused. Returning `renderNull`
  // here — the previous behavior — discarded that menu, which is why the
  // bubble never appeared. `InlineRichtextActionBar` renders ONLY those
  // children (the rich-text menu), and nothing when there are none, so the
  // bubble shows during inline editing without resurrecting Puck's default
  // duplicate/delete chrome. (Duplicate/delete are also disabled globally via
  // the `permissions` prop on <Puck> so they never reach `children`.)
  actionBar: InlineRichtextActionBar,
  fields: renderNull,
  fieldLabel: renderNull,
  components: renderNull,
  // `componentItem` wraps each rendered block on the canvas with insertion-
  // button affordances (Task 8.1, Reqs 4.1, 4.2, 4.3). The wrapper is
  // additive — it never hides the rendered component — and degrades to an
  // identity function when Puck invokes the override without positional
  // metadata.
  componentItem: componentItemOverride,
  drawer: renderNull,
  drawerItem: renderNull,
  outline: renderNull,
  // `puck` and `preview` are passthroughs so the canvas renders normally
  puck: ({ children }) => <>{children}</>,
  preview: ({ children }) => <>{children}</>,
};
