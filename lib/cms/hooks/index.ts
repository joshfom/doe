// Shared API helper
export { apiFetch } from "./api";

// Page hooks
export {
  usePages,
  usePage,
  useCreatePage,
  useUpdatePage,
  useDeletePage,
  usePublishPage,
  useUnpublishPage,
  useCloneLocale,
  useSetHomePage,
  pageKeys,
} from "./use-pages";

// Revision hooks
export { useRevisions, useRollback, revisionKeys } from "./use-revisions";

// Media hooks
export {
  useMedia,
  useUploadMedia,
  useDeleteMedia,
  useUpdateMediaAlt,
  mediaKeys,
} from "./use-media";

// Form hooks
export { useFormSubmissions, formKeys } from "./use-forms";

// Settings hooks
export {
  useSiteSettings,
  useUpdateSettings,
  settingsKeys,
} from "./use-settings";

// Audit hooks
export { useAuditLog, auditKeys } from "./use-audit";

// Component template hooks
export {
  useComponentTemplates,
  useSaveComponentTemplate,
  useDeleteComponentTemplate,
  componentTemplateKeys,
  type ComponentTemplateRecord,
  type SaveComponentTemplateInput,
} from "./use-component-templates";

// Post hooks
export {
  usePosts,
  usePost,
  useCreatePost,
  useUpdatePost,
  useDeletePost,
  usePublishPost,
  useUnpublishPost,
  useClonePostLocale,
  useRestorePost,
  usePermanentDeletePost,
  useTrashedPosts,
  postKeys,
} from "./use-posts";

// Blog category hooks
export {
  useBlogCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  blogCategoryKeys,
} from "./use-blog-categories";

// Blog tag hooks
export {
  useBlogTags,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  blogTagKeys,
} from "./use-blog-tags";

// Blog stats hooks
export {
  useBlogStats,
  useTopPosts,
  useShareBreakdown,
  useTrackView,
  useTrackShare,
  blogStatsKeys,
} from "./use-blog-stats";

// Post revision hooks
export {
  usePostRevisions,
  useRollbackPost,
  postRevisionKeys,
} from "./use-post-revisions";

// Menu hooks
export {
  useMenus,
  useMenu,
  useActiveMenu,
  useCreateMenu,
  useUpdateMenu,
  useDeleteMenu,
  useCreateMenuItem,
  useUpdateMenuItem,
  useDeleteMenuItem,
  useReorderMenuItems,
  useSetActiveMenu,
  menuKeys,
} from "./use-menus";

// Approval hooks
export {
  approvalKeys,
  useApprovalConfig,
  useUpdateApprovalConfig,
  usePendingApprovals,
  useApprovalDetail,
  useSubmitDecision,
  useContentApprovalStatus,
} from "./use-approvals";

// User hooks
export { userKeys, useUsers } from "./use-users";

// Ticket hooks
export {
  ticketKeys,
  useTickets,
  useTicket,
  useTicketCategories,
  useCreateTicket,
  useTransitionStatus,
  useAssignTicket,
  useAddNote,
  useUpdateTicketRequest,
  useTicketApprovals,
  usePendingTicketApprovals,
  useRequestTicketApproval,
  useDecideTicketApproval,
  useCancelTicketApproval,
  type TicketRecord,
  type TicketFilters,
  type TicketNoteRecord,
  type AuditTrailRecord,
  type TicketDetailResponse,
  type TicketApprovalRecord,
  type TicketApprovalScope,
  type TicketApprovalStatus,
} from "./use-tickets";

// Community & Project hooks
export {
  communityKeys,
  projectKeys,
  useCommunities,
  useCommunity,
  useCreateCommunity,
  useUpdateCommunity,
  useArchiveCommunity,
  useProjects,
  useProject,
  useCreateProject,
  useUpdateProject,
  useArchiveProject,
  type CommunityRecord,
  type ProjectRecord,
} from "./use-communities";
