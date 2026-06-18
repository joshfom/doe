// @vitest-environment node
/**
 * Inline-editor chunk unreachability — live-page-editor task 11.3.
 *
 * _Requirements: 2.4, 2.5_
 *
 * Req 2.4: a Public_Page MUST NOT issue any network request for the
 *          Inline_Editor_Provider client chunk, and that chunk MUST be absent
 *          from the route's client bundle.
 * Req 2.5: inline editing MUST be provided exclusively via the Live_Editor_Route.
 *
 * Rather than running a full (slow, environment-dependent) `next build` and
 * grepping `.next/static`, this asserts the same guarantee deterministically at
 * the source level: the inline-editor chunk can only enter a route's client
 * bundle if that route statically reaches the chunk's entry points
 * (`InlineEditorProvider` → `InlineEditorBootstrap` → the dynamically-imported
 * `InlineEditorClient`, plus the shared `InlineEditorInner` editor body and
 * everything under `lib/cms/inline-editor/`).
 *
 * The test walks the *static* import graph reachable from each of the four
 * public route files and asserts NONE of them transitively reaches any
 * inline-editor entry point or the `LiveEditorShell` editor surface. It then
 * walks the live editor route and asserts it IS the surface that reaches the
 * editor (`LiveEditorShell` → `InlineEditorInner`), proving inline editing lives
 * exclusively on the live route.
 *
 * This is an example-style integration test, not a property test.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// This test file lives at lib/cms/live-editor/ → repo root is three levels up.
const REPO_ROOT = path.resolve(__dirname, "../../..");

/** The four public route entry files returned to a purely-public state (task 11.1). */
const PUBLIC_ROUTE_FILES = [
  "app/(en)/page.tsx",
  "app/(en)/[...slug]/page.tsx",
  "app/ar/page.tsx",
  "app/ar/[...slug]/page.tsx",
].map((p) => path.join(REPO_ROOT, p));

/** The live editor route + its shell — the one surface that mounts the editor. */
const LIVE_ROUTE_FILE = path.join(REPO_ROOT, "app/ora-panel/live/[id]/page.tsx");
const LIVE_SHELL_FILE = path.join(REPO_ROOT, "lib/cms/live-editor/LiveEditorShell.tsx");
const INLINE_EDITOR_INNER_FILE = path.join(
  REPO_ROOT,
  "lib/cms/inline-editor/InlineEditorInner.tsx",
);

/** Anything under here is part of the inline-editor chunk's source. */
const INLINE_EDITOR_DIR = path.join(REPO_ROOT, "lib/cms/inline-editor");

/**
 * Entry-point file basenames (no extension) that bring the editor chunk into a
 * bundle. `InlineEditorProvider` lives under the route `_components/` dirs (not
 * the inline-editor dir), so it is matched by basename too.
 */
const EDITOR_ENTRY_BASENAMES = new Set([
  "InlineEditorProvider",
  "InlineEditorBootstrap",
  "InlineEditorClient",
  "InlineEditorInner",
]);

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];

/**
 * Resolve a local import specifier (`@/…` alias or relative) to an on-disk file.
 * Returns null for bare/external specifiers (node_modules) and unresolved
 * non-source assets (e.g. `.css`).
 */
function resolveModule(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) {
    base = path.join(REPO_ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null; // bare import → external dependency, not part of our graph
  }

  // file + known extension
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  // already has an extension
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  // directory index
  for (const ext of EXTENSIONS) {
    const candidate = path.join(base, "index" + ext);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const STATIC_IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_RE = /import\s*['"]([^'"]+)['"]/g;
// Tolerates a webpack magic comment between `(` and the specifier, e.g.
//   import(/* webpackChunkName: "inline-editor.chunk" */ "./InlineEditorClient")
const DYNAMIC_IMPORT_RE =
  /import\s*\(\s*(?:\/\*[^]*?\*\/\s*)?['"]([^'"]+)['"]\s*\)/g;
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Collect every import specifier (static, dynamic, side-effect, require) in a source file. */
function extractImportSpecifiers(src: string): string[] {
  const specs = new Set<string>();
  for (const re of [
    STATIC_IMPORT_RE,
    SIDE_EFFECT_IMPORT_RE,
    DYNAMIC_IMPORT_RE,
    REQUIRE_RE,
  ]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) specs.add(m[1]);
  }
  return [...specs];
}

/**
 * Walk the transitive static import graph from `entry`, following only local
 * (`@/…` / relative) source imports and skipping external/node_modules. Returns
 * the set of absolute file paths reachable from the entry (excluding the entry).
 */
function reachableFiles(entry: string): Set<string> {
  const visited = new Set<string>();
  const stack: string[] = [path.resolve(entry)];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    let src: string;
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {
      continue; // unreadable (shouldn't happen for resolved files)
    }

    for (const spec of extractImportSpecifiers(src)) {
      const resolved = resolveModule(spec, file);
      if (resolved && !resolved.includes(`${path.sep}node_modules${path.sep}`)) {
        stack.push(resolved);
      }
    }
  }

  visited.delete(path.resolve(entry));
  return visited;
}

function basenameNoExt(file: string): string {
  return path.basename(file).replace(/\.(ts|tsx|js|jsx|mts|cts)$/, "");
}

/** Files that constitute the inline-editor chunk / editor surface. */
function editorReachableFrom(entry: string): string[] {
  return [...reachableFiles(entry)].filter(
    (f) =>
      f.startsWith(INLINE_EDITOR_DIR + path.sep) ||
      EDITOR_ENTRY_BASENAMES.has(basenameNoExt(f)),
  );
}

describe("live-page-editor — inline-editor chunk unreachability (Req 2.4, 2.5)", () => {
  it("all four public route files exist and were located", () => {
    for (const file of PUBLIC_ROUTE_FILES) {
      expect(fs.existsSync(file), `missing public route file: ${file}`).toBe(true);
    }
    expect(fs.existsSync(LIVE_ROUTE_FILE)).toBe(true);
    expect(fs.existsSync(LIVE_SHELL_FILE)).toBe(true);
    expect(fs.existsSync(INLINE_EDITOR_INNER_FILE)).toBe(true);
  });

  describe("public routes cannot reach the inline-editor chunk (Req 2.4)", () => {
    for (const routeFile of PUBLIC_ROUTE_FILES) {
      const rel = path.relative(REPO_ROOT, routeFile);

      it(`${rel} does not directly import any inline-editor entry point`, () => {
        const src = fs.readFileSync(routeFile, "utf8");
        const specs = extractImportSpecifiers(src);

        for (const spec of specs) {
          expect(
            /InlineEditorProvider|InlineEditorBootstrap|InlineEditorClient|InlineEditorInner/.test(
              spec,
            ),
            `${rel} imports an inline-editor entry point: "${spec}"`,
          ).toBe(false);
          expect(
            spec.includes("lib/cms/inline-editor/"),
            `${rel} imports from lib/cms/inline-editor/: "${spec}"`,
          ).toBe(false);
        }
      });

      it(`${rel} does not transitively reach the inline-editor chunk or live shell`, () => {
        const reachable = reachableFiles(routeFile);

        const editorHits = editorReachableFrom(routeFile).map((f) =>
          path.relative(REPO_ROOT, f),
        );
        expect(
          editorHits,
          `${rel} transitively reaches inline-editor source: ${editorHits.join(", ")}`,
        ).toEqual([]);

        // The LiveEditorShell editor surface must not be reachable either.
        expect(
          reachable.has(LIVE_SHELL_FILE),
          `${rel} transitively reaches LiveEditorShell`,
        ).toBe(false);
        expect(
          reachable.has(INLINE_EDITOR_INNER_FILE),
          `${rel} transitively reaches InlineEditorInner`,
        ).toBe(false);
      });
    }
  });

  describe("the live editor route is the exclusive editor surface (Req 2.5)", () => {
    it("the live route reaches LiveEditorShell which mounts InlineEditorInner", () => {
      const reachable = reachableFiles(LIVE_ROUTE_FILE);

      // The route mounts the shell …
      expect(
        reachable.has(LIVE_SHELL_FILE),
        "live route does not reach LiveEditorShell",
      ).toBe(true);

      // … and the shell pulls in the shared inline editor body.
      expect(
        reachable.has(INLINE_EDITOR_INNER_FILE),
        "live route does not reach InlineEditorInner (the inline editor body)",
      ).toBe(true);

      // It genuinely reaches inline-editor chunk source.
      const editorHits = editorReachableFrom(LIVE_ROUTE_FILE);
      expect(editorHits.length).toBeGreaterThan(0);
    });

    it("LiveEditorShell statically imports InlineEditorInner", () => {
      const reachable = reachableFiles(LIVE_SHELL_FILE);
      expect(reachable.has(INLINE_EDITOR_INNER_FILE)).toBe(true);
    });
  });
});
