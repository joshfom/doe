"use client";

/**
 * OraInlineRichTextMenu — ORA-styled floating bubble for the native
 * `@puckeditor/core` inline rich-text editor.
 *
 * Wiring (verified against @puckeditor/core@0.21.2 internals):
 *
 *   - Each `type: "richtext"` field with `contentEditable: true` mounts a
 *     Tiptap editor inline on the canvas (Puck's `InlineEditorWrapper`).
 *   - When that editor is focused, Puck stores it as `currentRichText` and
 *     renders `<LoadedRichTextMenu inline />` INSIDE the selected block's
 *     overlay action bar (`overrides.actionBar`).
 *   - `LoadedRichTextMenuInner` wraps the menu in a `ControlContext` (editor +
 *     editorState) and then renders `field.renderInlineMenu` for the inline
 *     case, falling back to a Bold/Italic/Underline default.
 *
 * Because the controls are rendered inside that `ControlContext`, the exported
 * `RichTextMenu.*` controls (Bold, Italic, …) are already bound to the active
 * editor — this component just decides WHICH controls to show and in what
 * order. It must therefore stay a pure layout/selection component with no
 * editor wiring of its own.
 *
 * Per-field capability gating: Puck's `renderInlineMenu` signature does NOT
 * receive the field, so the control set is captured at config-build time via
 * {@link createOraInlineMenu}, which closes over the field's `options` (the
 * same `PuckRichTextOptions` Puck uses to register Tiptap extensions). A
 * control whose extension is disabled (`option === false`) is hidden so the
 * bubble never offers formatting the schema can't represent — keeping the Text
 * block's deliberately-minimal option set (no headings/links/blockquote)
 * honored in the UI (matching `config.ts`).
 *
 * NOTE: this component is rendered by Puck only inside the editor overlay (the
 * `actionBar` override), which never ships to anonymous public pages, so it
 * carries no SSR/public-bundle concerns.
 */

import React from "react";
import { RichTextMenu } from "@puckeditor/core";
import type { RichtextField } from "@puckeditor/core";

/**
 * The subset of `PuckRichTextOptions` this menu reacts to. An option is
 * "enabled" unless explicitly `false` (Puck's own convention — any
 * object/undefined means the extension is registered).
 */
type RichTextOptions = NonNullable<RichtextField["options"]>;

function isEnabled(options: RichTextOptions | undefined, key: keyof RichTextOptions): boolean {
  if (!options) return true;
  return options[key] !== false;
}

/**
 * Renders the ORA inline formatting bubble for a given option set. Controls
 * are grouped: heading selector, inline marks, lists, blockquote, alignment.
 * Every control is gated on `options` so the bubble can't offer formatting the
 * editor schema won't keep.
 */
function OraInlineRichTextMenu({ options }: { options: RichTextOptions | undefined }) {
  const showHeading = isEnabled(options, "heading");
  const showBold = isEnabled(options, "bold");
  const showItalic = isEnabled(options, "italic");
  const showUnderline = isEnabled(options, "underline");
  const showStrike = isEnabled(options, "strike");
  const showInlineCode = isEnabled(options, "code");
  const showBulletList = isEnabled(options, "bulletList");
  const showOrderedList = isEnabled(options, "orderedList");
  const showBlockquote = isEnabled(options, "blockquote");
  const showTextAlign = isEnabled(options, "textAlign");

  const hasMarks = showBold || showItalic || showUnderline || showStrike || showInlineCode;
  const hasLists = showBulletList || showOrderedList;

  return (
    <>
      {showHeading ? (
        <RichTextMenu.Group>
          <RichTextMenu.HeadingSelect />
        </RichTextMenu.Group>
      ) : null}

      {hasMarks ? (
        <RichTextMenu.Group>
          {showBold ? <RichTextMenu.Bold /> : null}
          {showItalic ? <RichTextMenu.Italic /> : null}
          {showUnderline ? <RichTextMenu.Underline /> : null}
          {showStrike ? <RichTextMenu.Strikethrough /> : null}
          {showInlineCode ? <RichTextMenu.InlineCode /> : null}
        </RichTextMenu.Group>
      ) : null}

      {hasLists ? (
        <RichTextMenu.Group>
          {showBulletList ? <RichTextMenu.BulletList /> : null}
          {showOrderedList ? <RichTextMenu.OrderedList /> : null}
        </RichTextMenu.Group>
      ) : null}

      {showBlockquote ? (
        <RichTextMenu.Group>
          <RichTextMenu.Blockquote />
        </RichTextMenu.Group>
      ) : null}

      {showTextAlign ? (
        <RichTextMenu.Group>
          <RichTextMenu.AlignLeft />
          <RichTextMenu.AlignCenter />
          <RichTextMenu.AlignRight />
          <RichTextMenu.AlignJustify />
        </RichTextMenu.Group>
      ) : null}
    </>
  );
}

/**
 * Builds a `renderInlineMenu` bound to a field's option set, for direct use in
 * a `RichtextField`:
 *
 *   {
 *     type: "richtext",
 *     contentEditable: true,
 *     options,
 *     renderInlineMenu: createOraInlineMenu(options),
 *   }
 *
 * Puck calls the returned function with `{ children, editor, editorState,
 * readOnly }` (no `field`), which is why the options are captured here. A
 * single stable function is returned per field so the `useMemo` in
 * `LoadedRichTextMenuInner` does not rebuild the menu on every render.
 */
export function createOraInlineMenu(
  options?: RichtextField["options"],
): NonNullable<RichtextField["renderInlineMenu"]> {
  return function renderOraInlineMenu() {
    return <OraInlineRichTextMenu options={options} />;
  };
}
