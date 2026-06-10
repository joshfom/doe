"use client";

/**
 * withInlineRichtextMenu — builder-only config augmentation that attaches an
 * ORA-styled `renderInlineMenu` to every `type: "richtext"` field.
 *
 * Why a builder-side wrapper (and not `config.ts` directly):
 * `lib/page-builder/config.ts` is imported by `PageRenderer`, which ships to
 * anonymous PUBLIC pages. `renderInlineMenu` pulls in the editor-only
 * `RichTextMenu` controls; binding it in `config.ts` would drag that editor
 * code into the public bundle (the same hygiene issue as the jsdom fix).
 * `renderInlineMenu` is consumed ONLY by the editor's inline menu host
 * (`LoadedRichTextMenuInner`), never by the public `Render`/`RichTextRender`
 * path — so the public config has no reason to carry it. This wrapper applies
 * the menu at the builder layer (`BuilderShell`, `InlineEditorClient`) only.
 *
 * The wrapper walks each component's fields (recursing into `array.arrayFields`
 * and `object.objectFields`, so nested richtext like the AccordionGroup item
 * `body` is covered) and, for each richtext field, sets `renderInlineMenu` to a
 * menu bound to that field's own `options`. Fields that already declare a
 * `renderInlineMenu` are left untouched so a block can opt out or override.
 *
 * Pure/immutable: the input config is never mutated; new field/component/config
 * objects are returned. Components are otherwise passed through unchanged, so
 * this composes with `withTrackingWrapper`, `withBreakpointClassNames`, etc.
 */

import type { Config, ComponentConfig, Fields, Field } from "@puckeditor/core";
import { createOraInlineMenu } from "./OraInlineRichTextMenu";

/** A field that has already had a menu attached needs no further work. */
function augmentField(field: Field): Field {
  if (field.type === "richtext") {
    if (field.renderInlineMenu) return field;
    return { ...field, renderInlineMenu: createOraInlineMenu(field.options) };
  }

  if (field.type === "array" && field.arrayFields) {
    return { ...field, arrayFields: augmentFields(field.arrayFields) };
  }

  if (field.type === "object" && field.objectFields) {
    return { ...field, objectFields: augmentFields(field.objectFields) };
  }

  return field;
}

function augmentFields(fields: Fields): Fields {
  const next: Record<string, Field> = {};
  for (const [name, field] of Object.entries(fields)) {
    next[name] = augmentField(field as Field);
  }
  return next as Fields;
}

function augmentComponent(component: ComponentConfig): ComponentConfig {
  if (!component.fields) return component;
  return { ...component, fields: augmentFields(component.fields) };
}

/**
 * Returns a copy of `config` whose richtext fields render the ORA inline
 * formatting bubble. Apply in builder/editor contexts only.
 */
export function withInlineRichtextMenu(config: Config): Config {
  const components: Record<string, ComponentConfig> = {};
  for (const [name, component] of Object.entries(config.components)) {
    components[name] = augmentComponent(component as ComponentConfig);
  }
  return { ...config, components };
}
