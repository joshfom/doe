/**
 * Builder Shell types — ORA presentation builder revamp.
 * See `.kiro/specs/ora-presentation-builder/design.md` for the data model.
 */

import type { Data as PuckData } from "@puckeditor/core";

export type DocumentMode = "slide" | "page";

export type DocumentStatus = "draft" | "published";

export interface SlideBackground {
  kind: "color" | "image" | "gradient";
  value: string;
}

export interface Slide {
  id: string;
  title: string;
  notes?: string;
  background: SlideBackground;
  data: PuckData;
}

export interface QuestionGroup {
  id: string;
  name: string;
  order: number;
}

export interface SlideDeck {
  slides: Slide[];
  questionGroups: QuestionGroup[];
}

export interface DocumentRecord {
  id: string;
  title: string;
  slug: string;
  mode: DocumentMode;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  /** populated when mode === "page" */
  pageData?: PuckData;
  /** populated when mode === "slide" */
  deck?: SlideDeck;
}

export type Selection =
  | { kind: "none" }
  | { kind: "document" }
  | { kind: "slide"; slideId: string }
  | { kind: "component"; itemId: string };

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export type SaveHandler = (record: DocumentRecord) => Promise<SaveResult>;
export type PublishHandler = (record: DocumentRecord) => Promise<SaveResult>;

export const DEFAULT_SLIDE_BACKGROUND: SlideBackground = {
  kind: "color",
  value: "#FFFFFF",
};
