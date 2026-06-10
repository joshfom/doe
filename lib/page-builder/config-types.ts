/**
 * Typed page-builder config that extends Puck's component config with the
 * ORA-specific `responsiveDefaults` declaration.
 *
 * Puck's `ComponentConfig` has no `responsiveDefaults` key, so declaring it on
 * a component in `config.ts` previously required `as any`/`as never` casts.
 * `OraComponentConfig` adds the optional field at the type level so components
 * can declare `responsiveDefaults` and be validated by the type system, and
 * `OraConfig` is the matching whole-config type.
 *
 * `ComponentConfig` and `Config` are both exported by `@puckeditor/core`, so no
 * module augmentation is required.
 *
 * Design reference: `.kiro/specs/builder-production-hardening/design.md`
 *   §"Typed component config — responsiveDefaults"
 * Validates: Requirements 1.4, 2.1, 2.2, 2.3, 2.4
 */

import type { Config, ComponentConfig } from "@puckeditor/core";
import type { ResponsiveDefaults } from "./responsive-defaults";

/** A Puck component config plus the ORA-specific `responsiveDefaults` declaration. */
export type OraComponentConfig = ComponentConfig & {
  responsiveDefaults?: ResponsiveDefaults;
};

/** The page-builder config whose components may carry `responsiveDefaults`. */
export type OraConfig = Omit<Config, "components"> & {
  components: Record<string, OraComponentConfig>;
};
