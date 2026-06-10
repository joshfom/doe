"use client";

/**
 * InspectorRichtextField — compact HTML-string richtext editor for the
 * builder's right-side configuration panel.
 *
 * The on-canvas inline editor handles richtext for top-level fields,
 * but array-item richtext (Accordion item body, IconFeatureList content)
 * is only reachable through the panel — those array rows are collapsed
 * by default and have no on-canvas selection target. This control gives
 * users formatting (bold / italic / underline / lists / link) without
 * leaving the panel.
 *
 * Tiptap modules are lazy-imported the first time the editor mounts so
 * they don't bloat the editor's initial chunk.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  Undo2,
  Redo2,
  RemoveFormatting,
} from "lucide-react";
import { OraTextField } from "./OraFields";

type EditorInstance = import("@tiptap/react").Editor;

interface TiptapModules {
  Editor: typeof import("@tiptap/react").Editor;
  EditorContent: typeof import("@tiptap/react").EditorContent;
  StarterKit: typeof import("@tiptap/starter-kit").default;
  Link: typeof import("@tiptap/extension-link").default;
}

let modulesPromise: Promise<TiptapModules> | null = null;

function loadModules(): Promise<TiptapModules> {
  if (!modulesPromise) {
    modulesPromise = (async () => {
      const [
        { Editor, EditorContent },
        { default: StarterKit },
        { default: Link },
      ] = await Promise.all([
        import("@tiptap/react"),
        import("@tiptap/starter-kit"),
        import("@tiptap/extension-link"),
      ]);
      return { Editor, EditorContent, StarterKit, Link };
    })();
  }
  return modulesPromise;
}

export interface InspectorRichtextFieldProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
}

export function InspectorRichtextField({
  label,
  value,
  onChange,
}: InspectorRichtextFieldProps) {
  const [modules, setModules] = useState<TiptapModules | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadModules()
      .then((mods) => {
        if (!cancelled) setModules(mods);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadFailed) {
    // Fallback to plain HTML textarea if Tiptap fails to load. The user
    // still gets something they can edit and the public renderer will
    // sanitize the HTML on save.
    return (
      <OraTextField
        label={label}
        value={value}
        onChange={onChange}
        multiline
        placeholder="<p>Enter text…</p>"
      />
    );
  }

  if (!modules) {
    // Loading skeleton — keep the field height stable so panel layout
    // doesn't jump while the editor mounts.
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Label text={label} />
        <div
          style={{
            border: "1px solid #E8E4DF",
            background: "#FAFAFA",
            minHeight: 110,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#9A9A9A",
            fontSize: 12,
          }}
        >
          Loading editor…
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Label text={label} />
      <RichtextEditor modules={modules} value={value} onChange={onChange} />
    </div>
  );
}

function Label({ text }: { text: string }) {
  return (
    <label
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "#7A7A7A",
      }}
    >
      {text}
    </label>
  );
}

function RichtextEditor({
  modules,
  value,
  onChange,
}: {
  modules: TiptapModules;
  value: string;
  onChange: (next: string) => void;
}) {
  const { Editor, EditorContent, StarterKit, Link } = modules;

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [editor, setEditor] = useState<EditorInstance | null>(null);
  const editorRef = useRef<EditorInstance | null>(null);

  useEffect(() => {
    const instance = new Editor({
      extensions: [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
        }),
      ],
      content: value || "",
      editorProps: {
        attributes: {
          class: "ora-inspector-richtext",
        },
      },
      onUpdate: ({ editor: ed }) => {
        const html = ed.getHTML();
        // Tiptap returns "<p></p>" for an empty doc — store as empty string
        // instead so consumers see a real "empty" signal.
        onChangeRef.current(html === "<p></p>" ? "" : html);
      },
    });
    editorRef.current = instance;
    setEditor(instance);
    return () => {
      instance.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (e.g. switching between array items)
  // into the editor without firing onUpdate.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || "";
    const normalizedCurrent = current === "<p></p>" ? "" : current;
    if (normalizedCurrent !== incoming) {
      editor.commands.setContent(incoming || "", { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div
        style={{
          border: "1px solid #E8E4DF",
          background: "#FAFAFA",
          minHeight: 110,
        }}
      />
    );
  }

  return (
    <div
      style={{
        border: "1px solid #E8E4DF",
        background: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Toolbar editor={editor} />
      <div
        style={{
          padding: "8px 10px",
          minHeight: 100,
          fontSize: 13,
          lineHeight: 1.5,
          color: "#2C2C2C",
        }}
      >
        <style>{INSPECTOR_RICHTEXT_STYLES}</style>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: EditorInstance }) {
  const promptForLink = useCallback(() => {
    if (typeof window === "undefined") return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const next = window.prompt("Link URL (leave empty to remove):", previous ?? "");
    if (next === null) return;
    if (next === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: next }).run();
  }, [editor]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 2,
        padding: 4,
        borderBottom: "1px solid #E8E4DF",
        background: "#F9F7F5",
      }}
    >
      <ToolButton
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Bold"
      >
        <Bold size={14} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italic"
      >
        <Italic size={14} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        title="Underline"
      >
        <UnderlineIcon size={14} />
      </ToolButton>
      <Sep />
      <ToolButton
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        <List size={14} />
      </ToolButton>
      <ToolButton
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Numbered list"
      >
        <ListOrdered size={14} />
      </ToolButton>
      <Sep />
      <ToolButton
        active={editor.isActive("link")}
        onClick={promptForLink}
        title="Link"
      >
        <LinkIcon size={14} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        title="Clear formatting"
      >
        <RemoveFormatting size={14} />
      </ToolButton>
      <Sep />
      <ToolButton
        onClick={() => editor.chain().focus().undo().run()}
        title="Undo"
      >
        <Undo2 size={14} />
      </ToolButton>
      <ToolButton
        onClick={() => editor.chain().focus().redo().run()}
        title="Redo"
      >
        <Redo2 size={14} />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  active = false,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        background: active ? "#2C2C2C" : "transparent",
        color: active ? "#FFF" : "#2C2C2C",
        border: "1px solid transparent",
        borderRadius: 4,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return (
    <span
      aria-hidden
      style={{
        width: 1,
        height: 18,
        background: "#E5E1DA",
        margin: "0 2px",
      }}
    />
  );
}

const INSPECTOR_RICHTEXT_STYLES = `
.ora-inspector-richtext {
  outline: none;
  min-height: 80px;
}
.ora-inspector-richtext p {
  margin: 0 0 8px 0;
}
.ora-inspector-richtext p:last-child {
  margin-bottom: 0;
}
.ora-inspector-richtext ul,
.ora-inspector-richtext ol {
  margin: 0 0 8px 0;
  padding-left: 20px;
}
.ora-inspector-richtext a {
  color: #B8956B;
  text-decoration: underline;
}
.ora-inspector-richtext strong {
  font-weight: 700;
}
.ora-inspector-richtext em {
  font-style: italic;
}
.ora-inspector-richtext u {
  text-decoration: underline;
}
`;
