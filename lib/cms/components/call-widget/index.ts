/**
 * DOE Call Widget — public entry point.
 *
 * Single-import surface so the widget can be embedded on any page with:
 *   `import { CallWidget } from "@/lib/cms/components/call-widget";`
 */

export { CallWidget } from "./CallWidget";
export type { CallWidgetProps } from "./CallWidget";
export { PreCallForm } from "./PreCallForm";
export type { PreCallFormProps } from "./PreCallForm";
export {
  DEFAULT_COUNTRY_ISO2,
  DEFAULT_DIAL_CODE,
  isValidE164,
  isValidEmail,
  isPhoneAcceptable,
  canSubmitPreCall,
  buildSessionInput,
  type PreCallFormState,
} from "./validation";
export { callWidgetI18n, type CallWidgetStrings } from "./i18n";
