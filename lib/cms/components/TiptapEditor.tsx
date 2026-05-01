"use client";

import { useCallback, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { MediaPickerModal } from "./MediaPickerModal";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  Quote,
  Code,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface TiptapEditorProps {
  content?: Record<string, unknown>;
  onChange: (json: Record<string, unknown>) => void;
}

// ── Toolbar Button ───────────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-8 w-8 items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2 focus-visible:outline-none ${
        active
          ? "bg-ora-charcoal text-ora-white"
          : "text-ora-charcoal-light hover:bg-ora-cream-dark"
      }`}
    >
      {children}
    </button>
  );
}

// ── Toolbar Separator ────────────────────────────────────────────────────────

function ToolbarSeparator() {
  return <div className="mx-1 h-5 w-px bg-ora-sand" />;
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({
  editor,
  onImageClick,
}: {
  editor: Editor | null;
  onImageClick: () => void;
}) {
  if (!editor) return null;

  const iconSize = "h-4 w-4 stroke-1";

  const handleLink = () => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("Enter URL:");
    if (url) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-ora-sand bg-ora-cream-light px-2 py-1.5">
      {/* Headings */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        <Heading1 className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        <Heading2 className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        <Heading3 className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        active={editor.isActive("heading", { level: 4 })}
        title="Heading 4"
      >
        <Heading4 className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
        active={editor.isActive("heading", { level: 5 })}
        title="Heading 5"
      >
        <Heading5 className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 6 }).run()}
        active={editor.isActive("heading", { level: 6 })}
        title="Heading 6"
      >
        <Heading6 className={iconSize} />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Inline formatting */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        title="Bold"
      >
        <Bold className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        title="Italic"
      >
        <Italic className={iconSize} />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Lists */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet List"
      >
        <List className={iconSize} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Ordered List"
      >
        <ListOrdered className={iconSize} />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Link */}
      <ToolbarButton
        onClick={handleLink}
        active={editor.isActive("link")}
        title="Link"
      >
        <LinkIcon className={iconSize} />
      </ToolbarButton>

      {/* Image */}
      <ToolbarButton onClick={onImageClick} title="Image">
        <ImageIcon className={iconSize} />
      </ToolbarButton>

      <ToolbarSeparator />

      {/* Blockquote */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <Quote className={iconSize} />
      </ToolbarButton>

      {/* Code Block */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code Block"
      >
        <Code className={iconSize} />
      </ToolbarButton>
    </div>
  );
}

// ── Editor Component ─────────────────────────────────────────────────────────

export function TiptapEditor({ content, onChange }: TiptapEditorProps) {
  const [mediaOpen, setMediaOpen] = useState(false);

  const handleUpdate = useCallback(
    ({ editor }: { editor: { getJSON: () => Record<string, unknown> } }) => {
      onChange(editor.getJSON());
    },
    [onChange]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-ora-gold underline" },
      }),
      Image.configure({
        HTMLAttributes: { class: "max-w-full h-auto" },
      }),
    ],
    content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[300px] px-4 py-3 text-ora-charcoal focus:outline-none",
      },
    },
  });

  const handleImageSelect = useCallback(
    (url: string) => {
      if (editor) {
        editor.chain().focus().setImage({ src: url }).run();
      }
    },
    [editor]
  );

  return (
    <div className="border border-ora-stone bg-ora-white">
      <Toolbar editor={editor} onImageClick={() => setMediaOpen(true)} />
      <EditorContent editor={editor} />
      <MediaPickerModal
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        onSelect={handleImageSelect}
        mimeTypeFilter="image/"
      />
    </div>
  );
}
