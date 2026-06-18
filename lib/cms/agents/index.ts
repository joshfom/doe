// lib/cms/agents/index.ts
//
// The public surface of the Mastra runtime (Requirement 1.3). Re-exports the
// ONE Mastra instance and the typed helpers consumed by the chat entry points,
// so callers depend on this single module rather than reaching into the
// internal runtime/switch files.
//
// [container-only] Everything re-exported here runs on the container/worker
// tier only, never on Next.js serverless (Requirement 15.3). Do NOT import this
// module from any `app/` route/page/layout — only from worker entrypoints.
//
// Design references: §Architecture (single Mastra configuration entry point),
// §Module layout. Requirements: 1.2, 1.3.

// The single Mastra instance + the agent-turn runner (with per-run budget).
export {
  mastra,
  runAgentTurn,
  DEFAULT_RUN_BUDGET,
  type RunAgentTurnOptions,
} from "./runtime";

// The deterministic ↔ agent routing helper (Migration_Switch, task 5.1).
export {
  routeCapability,
  serveCapability,
  recordDivergence,
  type Capability,
  type Path,
} from "./migration-switch";
