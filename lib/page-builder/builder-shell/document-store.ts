/**
 * DocumentStore — owns the open DocumentRecord plus dirty/save metadata
 * and exposes deck operations for Slide_Mode.
 */

import type { Data as PuckData } from "@puckeditor/core";
import { createStore } from "./store";
import type {
  DocumentRecord,
  Slide,
  SlideBackground,
  QuestionGroup,
} from "./types";
import { DEFAULT_SLIDE_BACKGROUND } from "./types";

export interface DocumentState {
  record: DocumentRecord;
  dirty: boolean;
  lastSavedAt: string | null;
  /** id of the currently active slide (Slide_Mode only) */
  activeSlideId: string | null;
}

export interface DocumentStoreApi {
  getState: () => DocumentState;
  subscribe: (listener: () => void) => () => void;
  // generic
  markSaved: () => void;
  setTitle: (title: string) => void;
  // page mode
  applyPageData: (data: PuckData) => void;
  // slide mode
  setActiveSlide: (slideId: string) => void;
  applySlideData: (slideId: string, data: PuckData) => void;
  addSlide: (afterSlideId?: string, partial?: Partial<Slide>) => Slide;
  duplicateSlide: (slideId: string) => Slide | null;
  deleteSlide: (slideId: string) => void;
  reorderSlide: (fromIndex: number, toIndex: number) => void;
  setSlideBackground: (slideId: string, background: SlideBackground) => void;
  setSlideTitle: (slideId: string, title: string) => void;
  setSlideNotes: (slideId: string, notes: string) => void;
  // question groups
  addQuestionGroup: (name: string) => QuestionGroup;
  renameQuestionGroup: (id: string, name: string) => void;
  deleteQuestionGroup: (id: string) => void;
  reorderQuestionGroup: (fromIndex: number, toIndex: number) => void;
}

const EMPTY_PUCK_DATA: PuckData = { content: [], root: { props: {} } };

let _idCounter = 0;
const genId = (prefix: string): string => {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
};

const makeSlide = (partial: Partial<Slide> = {}): Slide => ({
  id: partial.id ?? genId("slide"),
  title: partial.title ?? "Untitled slide",
  notes: partial.notes,
  background: partial.background ?? { ...DEFAULT_SLIDE_BACKGROUND },
  data: partial.data ?? structuredClone(EMPTY_PUCK_DATA),
});

export interface CreateDocumentStoreOptions {
  /** Override the id generator (useful for deterministic tests). */
  generateId?: (prefix: string) => string;
}

export function createDocumentStore(
  initial: DocumentRecord,
  options: CreateDocumentStoreOptions = {},
): DocumentStoreApi {
  const idFn = options.generateId ?? genId;

  const initialState: DocumentState = {
    record: initial,
    dirty: false,
    lastSavedAt: null,
    activeSlideId:
      initial.mode === "slide" ? initial.deck?.slides[0]?.id ?? null : null,
  };

  const store = createStore<DocumentState>(initialState);

  const mutate = (
    updater: (record: DocumentRecord) => DocumentRecord,
    opts: { dirty?: boolean } = {},
  ) => {
    store.setState((prev) => ({
      ...prev,
      record: updater(prev.record),
      dirty: opts.dirty ?? true,
    }));
  };

  const requireDeck = (record: DocumentRecord) => {
    if (record.mode !== "slide" || !record.deck) {
      throw new Error("DocumentStore: operation requires slide mode");
    }
    return record.deck;
  };

  const api: DocumentStoreApi = {
    getState: store.getState,
    subscribe: store.subscribe,

    markSaved: () => {
      store.setState((prev) => ({
        ...prev,
        dirty: false,
        lastSavedAt: new Date().toISOString(),
      }));
    },

    setTitle: (title) => mutate((r) => ({ ...r, title })),

    applyPageData: (data) =>
      mutate((r) => {
        if (r.mode !== "page") {
          throw new Error("DocumentStore: applyPageData requires page mode");
        }
        return { ...r, pageData: data };
      }),

    setActiveSlide: (slideId) => {
      store.setState((prev) => ({ ...prev, activeSlideId: slideId }));
    },

    applySlideData: (slideId, data) =>
      mutate((r) => {
        const deck = requireDeck(r);
        return {
          ...r,
          deck: {
            ...deck,
            slides: deck.slides.map((s) =>
              s.id === slideId ? { ...s, data } : s,
            ),
          },
        };
      }),

    addSlide: (afterSlideId, partial) => {
      const slide = makeSlide({ ...partial, id: partial?.id ?? idFn("slide") });
      mutate((r) => {
        const deck = requireDeck(r);
        const slides = [...deck.slides];
        const insertAt =
          afterSlideId == null
            ? slides.length
            : slides.findIndex((s) => s.id === afterSlideId) + 1;
        slides.splice(insertAt > 0 ? insertAt : slides.length, 0, slide);
        return { ...r, deck: { ...deck, slides } };
      });
      store.setState((prev) => ({ ...prev, activeSlideId: slide.id }));
      return slide;
    },

    duplicateSlide: (slideId) => {
      const state = store.getState();
      const deck = state.record.deck;
      const source = deck?.slides.find((s) => s.id === slideId);
      if (!source) return null;
      const copy: Slide = {
        ...source,
        id: idFn("slide"),
        title: `${source.title} (copy)`,
        data: structuredClone(source.data),
        background: { ...source.background },
      };
      mutate((r) => {
        const d = requireDeck(r);
        const slides = [...d.slides];
        const idx = slides.findIndex((s) => s.id === slideId);
        slides.splice(idx + 1, 0, copy);
        return { ...r, deck: { ...d, slides } };
      });
      store.setState((prev) => ({ ...prev, activeSlideId: copy.id }));
      return copy;
    },

    deleteSlide: (slideId) => {
      mutate((r) => {
        const deck = requireDeck(r);
        const slides = deck.slides.filter((s) => s.id !== slideId);
        return { ...r, deck: { ...deck, slides } };
      });
      store.setState((prev) => {
        if (prev.activeSlideId !== slideId) return prev;
        const slides = prev.record.deck?.slides ?? [];
        return { ...prev, activeSlideId: slides[0]?.id ?? null };
      });
    },

    reorderSlide: (fromIndex, toIndex) => {
      mutate((r) => {
        const deck = requireDeck(r);
        const slides = [...deck.slides];
        if (
          fromIndex < 0 ||
          fromIndex >= slides.length ||
          toIndex < 0 ||
          toIndex >= slides.length ||
          fromIndex === toIndex
        ) {
          return r;
        }
        const [moved] = slides.splice(fromIndex, 1);
        slides.splice(toIndex, 0, moved);
        return { ...r, deck: { ...deck, slides } };
      });
    },

    setSlideBackground: (slideId, background) =>
      mutate((r) => {
        const deck = requireDeck(r);
        return {
          ...r,
          deck: {
            ...deck,
            slides: deck.slides.map((s) =>
              s.id === slideId ? { ...s, background } : s,
            ),
          },
        };
      }),

    setSlideTitle: (slideId, title) =>
      mutate((r) => {
        const deck = requireDeck(r);
        return {
          ...r,
          deck: {
            ...deck,
            slides: deck.slides.map((s) =>
              s.id === slideId ? { ...s, title } : s,
            ),
          },
        };
      }),

    setSlideNotes: (slideId, notes) =>
      mutate((r) => {
        const deck = requireDeck(r);
        return {
          ...r,
          deck: {
            ...deck,
            slides: deck.slides.map((s) =>
              s.id === slideId ? { ...s, notes } : s,
            ),
          },
        };
      }),

    addQuestionGroup: (name) => {
      const group: QuestionGroup = {
        id: idFn("qg"),
        name,
        order: 0,
      };
      mutate((r) => {
        const deck = requireDeck(r);
        const groups = [...deck.questionGroups, { ...group, order: deck.questionGroups.length }];
        return { ...r, deck: { ...deck, questionGroups: groups } };
      });
      return { ...group, order: store.getState().record.deck!.questionGroups.length - 1 };
    },

    renameQuestionGroup: (id, name) =>
      mutate((r) => {
        const deck = requireDeck(r);
        return {
          ...r,
          deck: {
            ...deck,
            questionGroups: deck.questionGroups.map((g) =>
              g.id === id ? { ...g, name } : g,
            ),
          },
        };
      }),

    deleteQuestionGroup: (id) =>
      mutate((r) => {
        const deck = requireDeck(r);
        return {
          ...r,
          deck: {
            ...deck,
            questionGroups: deck.questionGroups
              .filter((g) => g.id !== id)
              .map((g, i) => ({ ...g, order: i })),
          },
        };
      }),

    reorderQuestionGroup: (fromIndex, toIndex) =>
      mutate((r) => {
        const deck = requireDeck(r);
        const groups = [...deck.questionGroups];
        if (
          fromIndex < 0 ||
          fromIndex >= groups.length ||
          toIndex < 0 ||
          toIndex >= groups.length ||
          fromIndex === toIndex
        ) {
          return r;
        }
        const [moved] = groups.splice(fromIndex, 1);
        groups.splice(toIndex, 0, moved);
        return {
          ...r,
          deck: {
            ...deck,
            questionGroups: groups.map((g, i) => ({ ...g, order: i })),
          },
        };
      }),
  };

  return api;
}

export const __test_makeSlide = makeSlide;
