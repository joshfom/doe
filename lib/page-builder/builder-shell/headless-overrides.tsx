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

const renderNull = () => <></> as unknown as React.ReactElement;

export const headlessOverrides: Partial<Overrides> = {
  header: renderNull,
  headerActions: renderNull,
  actionBar: renderNull,
  fields: renderNull,
  fieldLabel: renderNull,
  components: renderNull,
  componentItem: renderNull,
  drawer: renderNull,
  drawerItem: renderNull,
  outline: renderNull,
  // `puck` and `preview` are passthroughs so the canvas renders normally
  puck: ({ children }) => <>{children}</>,
  preview: ({ children }) => <>{children}</>,
};
