/**
 * Provider registration bootstrap — Prospecting Workspace (S7).
 *
 * The concrete Account/Person adapters self-register into the shared
 * {@link providerRegistry} as an import side-effect. Something on the RUNTIME
 * path must import them, or the registry stays empty and `prospect_search`
 * fans out to nobody. This barrel performs those side-effect imports in the
 * canonical order; importing it once (from the catalog tools) wires every
 * provider whose credentials/flag are present.
 *
 * Each adapter still decides at call time whether it is configured (returning
 * `{ unconfigured: true }` when its key/flag is absent), so importing them all
 * here is safe and free — an unconfigured provider makes no network call.
 */

import "./apollo";
import "./pdl";
import "./cognism";
import "./crunchbase";
import "./demo";
