// @vitest-environment jsdom
/**
 * Nav visibility test for the Voice Console panel item (S6 task 8.2).
 *
 * Validates: Requirements 8.2, 8.3, 8.4 — the Voice Console nav item is shown
 * when the user's permissions satisfy `voice:console` (including `voice:*` and
 * `*:*` wildcards) and hidden otherwise, and no existing item's visibility
 * changes (an always-visible item and a differently-gated item are asserted
 * alongside).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

const pathnameMock = vi.fn<() => string>();

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as object)} />,
}));

import OraPanelLayout from "./layout";

function renderWithPermissions(permissions: string[]) {
  pathnameMock.mockReturnValue("/ora-panel/pages");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { userId: "u-1", permissions } }),
    } as unknown as Response),
  );
  return render(
    <OraPanelLayout>
      <div data-testid="child">x</div>
    </OraPanelLayout>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const VOICE_HREF = "/ora-panel/voice-console";

describe("Voice Console nav item visibility (Req 8.2, 8.3, 8.4)", () => {
  it("shows the item for an exact voice:console grant", async () => {
    const { container } = renderWithPermissions(["voice:console", "pages:read"]);
    await waitFor(() => {
      expect(container.querySelector("nav")).not.toBeNull();
    });
    expect(
      container.querySelector(`a[href="${VOICE_HREF}"]`),
    ).not.toBeNull();
    // An existing, differently-gated item is still present (Req 8.4).
    expect(
      container.querySelector('a[href="/ora-panel/pages"]'),
    ).not.toBeNull();
  });

  it("shows the item for the voice:* and *:* wildcards", async () => {
    for (const perms of [["voice:*"], ["*:*"]]) {
      const { container, unmount } = renderWithPermissions(perms);
      await waitFor(() => {
        expect(container.querySelector("nav")).not.toBeNull();
      });
      expect(
        container.querySelector(`a[href="${VOICE_HREF}"]`),
      ).not.toBeNull();
      unmount();
    }
  });

  it("hides the item when permissions do not satisfy voice:console", async () => {
    const { container } = renderWithPermissions(["pages:read", "posts:read"]);
    await waitFor(() => {
      expect(container.querySelector("nav")).not.toBeNull();
    });
    expect(container.querySelector(`a[href="${VOICE_HREF}"]`)).toBeNull();
    // Existing items remain visible — only the gated voice item is hidden.
    expect(
      container.querySelector('a[href="/ora-panel/pages"]'),
    ).not.toBeNull();
  });
});
