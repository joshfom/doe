/**
 * Re-export of the English InlineEditorProvider for the Arabic locale.
 *
 * Spec: custom-branded-page-builder — task 14.1
 *
 * The provider is locale-agnostic: it gates on session + RBAC + feature
 * flag, none of which depend on locale. Re-exporting (rather than
 * duplicating) keeps a single source of truth so future RBAC changes
 * apply to both locales without drift.
 */

export { InlineEditorProvider } from "@/app/(en)/_components/InlineEditorProvider";
