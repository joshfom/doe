import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createDocumentStore } from "./document-store";
import type { DocumentRecord, SlideDeck } from "./types";

const makeDeckDoc = (slideCount: number): DocumentRecord => {
  const deck: SlideDeck = {
    slides: Array.from({ length: slideCount }, (_, i) => ({
      id: `seed-${i}`,
      title: `Slide ${i + 1}`,
      background: { kind: "color", value: "#FFFFFF" },
      data: { content: [], root: { props: {} } },
    })),
    questionGroups: [],
  };
  return {
    id: "doc-1",
    title: "Deck",
    slug: "deck",
    mode: "slide",
    status: "draft",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    deck,
  };
};

const slideIds = (store: ReturnType<typeof createDocumentStore>) =>
  store.getState().record.deck!.slides.map((s) => s.id);

describe("documentStore — slide ops invariants", () => {
  it("addSlide grows length by 1 and produces a unique id (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (n) => {
        const doc = makeDeckDoc(n);
        const store = createDocumentStore(doc);
        const before = slideIds(store);
        const created = store.addSlide();
        const after = slideIds(store);
        expect(after).toHaveLength(before.length + 1);
        expect(new Set(after).size).toBe(after.length);
        expect(after.includes(created.id)).toBe(true);
      }),
    );
  });

  it("duplicateSlide preserves id uniqueness (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
        const store = createDocumentStore(makeDeckDoc(n));
        const sourceId = slideIds(store)[0];
        const copy = store.duplicateSlide(sourceId);
        const after = slideIds(store);
        expect(copy).not.toBeNull();
        expect(after).toHaveLength(n + 1);
        expect(new Set(after).size).toBe(after.length);
      }),
    );
  });

  it("deleteSlide removes only the requested id (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
        const store = createDocumentStore(makeDeckDoc(n));
        const before = slideIds(store);
        const target = before[Math.floor(before.length / 2)];
        store.deleteSlide(target);
        const after = slideIds(store);
        expect(after).toHaveLength(n - 1);
        expect(after).not.toContain(target);
        for (const id of before) {
          if (id !== target) expect(after).toContain(id);
        }
      }),
    );
  });

  it("reorderSlide is a permutation (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 7 }),
        (n, fromRaw, toRaw) => {
          const store = createDocumentStore(makeDeckDoc(n));
          const before = slideIds(store);
          const from = fromRaw % n;
          const to = toRaw % n;
          store.reorderSlide(from, to);
          const after = slideIds(store);
          expect(after).toHaveLength(n);
          expect(new Set(after)).toEqual(new Set(before));
        },
      ),
    );
  });

  it("activeSlideId follows after delete + add", () => {
    const store = createDocumentStore(makeDeckDoc(2));
    const initialActive = store.getState().activeSlideId;
    expect(initialActive).toBe("seed-0");
    store.deleteSlide("seed-0");
    expect(store.getState().activeSlideId).toBe("seed-1");
    const created = store.addSlide();
    expect(store.getState().activeSlideId).toBe(created.id);
  });

  it("markSaved clears dirty and stamps lastSavedAt", () => {
    const store = createDocumentStore(makeDeckDoc(1));
    store.addSlide();
    expect(store.getState().dirty).toBe(true);
    store.markSaved();
    const s = store.getState();
    expect(s.dirty).toBe(false);
    expect(typeof s.lastSavedAt).toBe("string");
  });
});
