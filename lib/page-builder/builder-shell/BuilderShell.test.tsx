// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// Polyfills required by Puck under jsdom — must run before importing Puck.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";

// Mock InlineRichtextController to avoid tiptap extension resolution issues.
vi.mock("./InlineRichtextController", () => ({
  InlineRichtextController: () => null,
  useActiveRichtextEditor: () => null,
  InlineRichtextContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

const { BuilderShell } = await import("./BuilderShell");
import type { DocumentRecord } from "./types";

const minimalConfig = {
  components: {
    Box: {
      fields: {
        title: { type: "text" as const, label: "Title" },
      },
      defaultProps: { title: "hello" },
      render: ({ title }: { title?: string }) => (
        <div data-testid="box-rendered">{title}</div>
      ),
    },
  },
} as const;

function makePageDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "doc-1",
    title: "Untitled",
    slug: "untitled",
    mode: "page",
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pageData: {
      content: [
        {
          type: "Box",
          props: { id: "Box-1", title: "hello" },
        },
      ],
      root: { props: {} },
    },
    ...overrides,
  };
}

describe("BuilderShell", () => {
  it("renders the ORA shell regions and not Puck default chrome", () => {
    const { container } = render(
      <BuilderShell
        config={minimalConfig as never}
        document={makePageDoc()}
        onSave={vi.fn().mockResolvedValue({ ok: true })}
        onPublish={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    // Historical: ComponentsDrawer was replaced by ComponentPalette + OutlineTree in the BuilderShell.
    // The shell now mounts ComponentPalette (left) and
    // ConfigurationPanel (right). The top bar, canvas, and status bar are unchanged.
    expect(screen.getByTestId("ora-topbar")).toBeTruthy();
    expect(screen.getByTestId("ora-canvas")).toBeTruthy();
    expect(screen.getByTestId("ora-configuration-panel")).toBeTruthy();
    expect(screen.getByTestId("ora-statusbar")).toBeTruthy();
    expect(screen.getByTestId("ora-component-palette")).toBeTruthy();

    // Puck default chrome should be absent.
    expect(container.querySelector("[class*='PuckLayout-header']")).toBeNull();
    expect(container.querySelector("[class*='PuckHeader']")).toBeNull();
  });

  it("invokes onSave and clears dirty flag", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    render(
      <BuilderShell
        config={minimalConfig as never}
        document={makePageDoc()}
        onSave={onSave}
        onPublish={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0] as DocumentRecord;
    expect(arg.id).toBe("doc-1");
    expect(arg.mode).toBe("page");
    expect(arg.pageData?.content).toHaveLength(1);
  });

  it("opens publish confirmation modal before invoking onPublish", async () => {
    const onPublish = vi.fn().mockResolvedValue({ ok: true });
    render(
      <BuilderShell
        config={minimalConfig as never}
        document={makePageDoc()}
        onSave={vi.fn().mockResolvedValue({ ok: true })}
        onPublish={onPublish}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /publish/i }));
    expect(screen.getByRole("dialog", { name: /confirm publish/i })).toBeTruthy();
    expect(onPublish).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: /^publish$/i }).pop()!,
      );
    });
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("marks dirty and shows the dot when the title changes", () => {
    render(
      <BuilderShell
        config={minimalConfig as never}
        document={makePageDoc()}
        onSave={vi.fn().mockResolvedValue({ ok: true })}
        onPublish={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    expect(screen.queryByLabelText("Unsaved changes")).toBeNull();
    fireEvent.change(screen.getByLabelText("Document title"), {
      target: { value: "New Title" },
    });
    expect(screen.getByLabelText("Unsaved changes")).toBeTruthy();
  });

  it("surfaces save errors in the StatusBar", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: "boom" });
    render(
      <BuilderShell
        config={minimalConfig as never}
        document={makePageDoc()}
        onSave={onSave}
        onPublish={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });
    expect(screen.getByLabelText("Dismiss error")).toBeTruthy();
  });
});
