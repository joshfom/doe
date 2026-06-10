/**
 * Browser-only stub for `jsdom`.
 *
 * `lib/page-builder/richtext/sanitize.ts` is an isomorphic module that is pulled
 * into the CLIENT bundle (it is imported by the `"use client"` `config.ts`). Its
 * server branch calls `require("jsdom")` to build a DOMPurify window during SSR.
 * That branch is guarded at runtime by `typeof window !== "undefined"`, so it
 * NEVER runs in the browser — but Turbopack still statically follows the
 * `require("jsdom")` when building the client bundle, dragging in jsdom (and its
 * Node-only `fs` dependency) and breaking the build with
 * "Module not found: Can't resolve 'fs'".
 *
 * `next.config.ts` aliases `jsdom` to this stub under the Turbopack `browser`
 * condition, so the client bundle gets this inert module instead of the real
 * one. On the server, `jsdom` resolves normally (it is in Next's default
 * `serverExternalPackages` list and runs via native Node `require`).
 *
 * The export shape mirrors the single member the sanitizer touches
 * (`{ JSDOM }`). If this stub were ever reached at runtime, `new JSDOM(...)`
 * would throw and the sanitizer's `try/catch` would fail closed (return ""),
 * preserving the security guarantee — but the `window` guard means it never is.
 */
export class JSDOM {
  constructor() {
    throw new Error(
      "jsdom is not available in the browser bundle. This stub should never be " +
        "constructed at runtime; the sanitizer's server branch is guarded by a " +
        "`typeof window` check.",
    );
  }
}
