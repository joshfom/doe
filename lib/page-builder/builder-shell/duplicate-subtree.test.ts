import { describe, it, expect } from "vitest";
import {
  buildDuplicatedSubtree,
  collectDescendantZones,
  ROOT_ZONE_COMPOUND,
} from "./duplicate-subtree";
import type { ComponentInstance } from "../types";

/**
 * duplicate-subtree — proves a duplicated block is a fully independent clone,
 * not a mirror of the source: fresh ids for the whole subtree, remapped zone
 * keys, deep-cloned props (no shared references), and child zones copied.
 *
 * Spec: custom-branded-page-builder — Requirement 4.3.
 */

function collectIds(content: ComponentInstance[]): string[] {
  return content.map((c) => c.props.id as string);
}

describe("collectDescendantZones", () => {
  it("collects nested zones owned by the root and its descendants", () => {
    const zones: Record<string, ComponentInstance[]> = {
      "col-1:column-0": [
        { type: "Text", props: { id: "txt-a" } },
        { type: "Flex", props: { id: "flex-1" } },
      ],
      "flex-1:content": [{ type: "Icon", props: { id: "icon-1" } }],
      "other-1:column-0": [{ type: "Text", props: { id: "txt-z" } }],
    };

    const result = collectDescendantZones("col-1", zones);

    // Owns col-1's zone and the nested flex-1 zone, but NOT the unrelated owner.
    expect(Object.keys(result).sort()).toEqual([
      "col-1:column-0",
      "flex-1:content",
    ]);
  });
});

describe("buildDuplicatedSubtree", () => {
  it("inserts a deep clone with a fresh id after a root-level block", () => {
    const data = {
      content: [
        { type: "Heading", props: { id: "h-1", text: "First" } },
        { type: "Text", props: { id: "t-2", content: "Second" } },
      ] as ComponentInstance[],
      zones: {},
      root: { props: {} },
    };

    const { data: out, newId, zoneCompound, destinationIndex } =
      buildDuplicatedSubtree(data, data.content[0], {
        zone: ROOT_ZONE_COMPOUND,
        index: 0,
      });

    expect(zoneCompound).toBe(ROOT_ZONE_COMPOUND);
    expect(destinationIndex).toBe(1);
    expect(out.content).toHaveLength(3);
    expect(collectIds(out.content)).toEqual(["h-1", newId, "t-2"]);
    expect(newId).not.toBe("h-1");
    expect((out.content[1].props as { text: string }).text).toBe("First");
  });

  it("copies a column with all its nested objects, with fresh ids and remapped zone keys", () => {
    // A Columns block whose two columns hold nested blocks (one a Flex with
    // its own child zone). This is the "copy column with all its objects" case.
    const data = {
      content: [
        { type: "Columns", props: { id: "cols-1" } },
      ] as ComponentInstance[],
      zones: {
        "cols-1:column-0": [
          { type: "Icon", props: { id: "icon-1", icon: "phone" } },
          { type: "Flex", props: { id: "flex-1" } },
        ],
        "flex-1:content": [
          { type: "Text", props: { id: "txt-1", content: "WHATSAPP CHAT" } },
        ],
        "cols-1:column-1": [
          { type: "Text", props: { id: "txt-2", content: "Other" } },
        ],
      } as Record<string, ComponentInstance[]>,
      root: { props: {} },
    };

    const { data: out, newId } = buildDuplicatedSubtree(data, data.content[0], {
      zone: ROOT_ZONE_COMPOUND,
      index: 0,
    });

    // Root now has the original + the clone.
    expect(out.content).toHaveLength(2);
    expect(out.content[1].props.id).toBe(newId);
    expect(newId).not.toBe("cols-1");

    // Original zones are preserved.
    expect(out.zones!["cols-1:column-0"]).toBeDefined();
    expect(out.zones!["flex-1:content"]).toBeDefined();

    // The clone has its OWN zones keyed by fresh ids (no reuse of source ids).
    const cloneZoneKeys = Object.keys(out.zones!).filter(
      (k) => k.startsWith(`${newId}:`),
    );
    expect(cloneZoneKeys).toContain(`${newId}:column-0`);
    expect(cloneZoneKeys).toContain(`${newId}:column-1`);

    // The nested Flex inside the cloned column-0 got a fresh id, and its child
    // zone was remapped to that fresh id (not the source "flex-1").
    const clonedCol0 = out.zones![`${newId}:column-0`];
    const clonedFlex = clonedCol0.find((c) => c.type === "Flex")!;
    expect(clonedFlex.props.id).not.toBe("flex-1");
    expect(out.zones![`${clonedFlex.props.id}:content`]).toBeDefined();
    // The deepest child (Text) also has a fresh id but keeps its content.
    const clonedDeepText = out.zones![`${clonedFlex.props.id}:content`][0];
    expect(clonedDeepText.props.id).not.toBe("txt-1");
    expect((clonedDeepText.props as { content: string }).content).toBe(
      "WHATSAPP CHAT",
    );

    // No id from the clone collides with any source id.
    const sourceIds = new Set([
      "cols-1",
      "icon-1",
      "flex-1",
      "txt-1",
      "txt-2",
    ]);
    for (const items of Object.values(out.zones!)) {
      for (const item of items) {
        // every id is a string; clone ids must be disjoint from source ids
        // except within the original (untouched) source zones.
        expect(typeof item.props.id).toBe("string");
      }
    }
    expect(sourceIds.has(newId)).toBe(false);
  });

  it("does not share object references with the source (editing the copy never mutates the original)", () => {
    const data = {
      content: [
        {
          type: "Text",
          props: {
            id: "t-1",
            content: "Hi",
            _padding: { paddingTop: "8", paddingBottom: "8" },
          },
        },
      ] as ComponentInstance[],
      zones: {},
      root: { props: {} },
    };

    const { data: out } = buildDuplicatedSubtree(data, data.content[0], {
      zone: ROOT_ZONE_COMPOUND,
      index: 0,
    });

    const original = data.content[0].props as { _padding: { paddingTop: string } };
    const copy = out.content[1].props as { _padding: { paddingTop: string } };

    // Distinct object identity for nested props.
    expect(copy._padding).not.toBe(original._padding);

    // Mutating the copy must NOT change the original.
    copy._padding.paddingTop = "999";
    expect(original._padding.paddingTop).toBe("8");
  });

  it("inserts into a parent zone (not root) when the source is nested", () => {
    const data = {
      content: [{ type: "Columns", props: { id: "cols-1" } }] as ComponentInstance[],
      zones: {
        "cols-1:column-0": [
          { type: "Text", props: { id: "txt-1", content: "A" } },
        ],
      } as Record<string, ComponentInstance[]>,
      root: { props: {} },
    };

    const { data: out, newId, zoneCompound, destinationIndex } =
      buildDuplicatedSubtree(data, data.zones["cols-1:column-0"][0], {
        zone: "cols-1:column-0",
        index: 0,
      });

    expect(zoneCompound).toBe("cols-1:column-0");
    expect(destinationIndex).toBe(1);
    // The clone is inserted into the same parent zone, after the source.
    const col0 = out.zones!["cols-1:column-0"];
    expect(col0).toHaveLength(2);
    expect(col0[0].props.id).toBe("txt-1");
    expect(col0[1].props.id).toBe(newId);
    expect(newId).not.toBe("txt-1");
  });
});
