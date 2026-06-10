/**
 * Shared TypeScript interfaces for the array-item shapes used by the
 * general-purpose marketing blocks in the page-builder block library.
 *
 * These blocks store their repeating data as plain JSON arrays inside each
 * block's props (Puck `array` fields). The interfaces here describe those
 * in-memory item shapes so the block configs and render functions can share a
 * single typed contract. They introduce no database, persistence, or API
 * types — they are render + config concerns only.
 *
 * Slot-based blocks (TabGroup panels, CardGrid children) store standard Puck
 * slot content rather than custom item shapes, so they are not represented
 * here.
 *
 * Design reference: `.kiro/specs/page-builder-block-library/design.md`
 *   §"Array item shapes — `blocks/block-item-types.ts`"
 * Validates: Requirements 2.2, 4.2, 5.2, 7.2, 9.2
 */

/** A single testimonial entry rendered inside the Testimonial block. */
export interface TestimonialItem {
  /** Plain text or sanitized HTML (see sanitization note). */
  quote: string;
  /** Name of the person being quoted. */
  author: string;
  /** Optional role / company line. */
  role?: string;
  /** Optional avatar image URL (imageUploadField). */
  avatar?: string;
  /** Optional alt text for the avatar; defaults to the author name on render. */
  avatarAlt?: string;
  /** Optional rating from 0..5, clamped on render. */
  rating?: number;
}

/** A single logo entry rendered inside the LogoCloud block. */
export interface LogoItem {
  /** Logo image URL. */
  src: string;
  /** Alt text for the logo image. */
  alt: string;
  /** Optional link target; rendered as an anchor when present. */
  href?: string;
}

/** A single plan card rendered inside the PricingTable block. */
export interface PricingPlan {
  /** Plan name. */
  name: string;
  /** Free-text price ("$29", "Free", "Contact us"). */
  price: string;
  /** Optional period label ("/mo"). */
  period?: string;
  /** Newline-separated features; rendered as `<ul><li>`. */
  features: string;
  /** Marks the plan as "most popular". */
  highlight?: boolean;
  /** Optional CTA label. */
  ctaLabel?: string;
  /** Optional CTA destination URL. */
  ctaUrl?: string;
}

/** A single social link rendered inside the SocialLinks block. */
export interface SocialItem {
  /** Key into ICON_MAP (incl. brand icons). */
  icon: string;
  /** Destination URL. */
  href: string;
  /** Optional accessible name override ("Visit our Instagram"). */
  label?: string;
}

/** A single breadcrumb entry rendered inside the Breadcrumbs block. */
export interface BreadcrumbItem {
  /** Visible label for the breadcrumb. */
  label: string;
  /** Optional link target; omitted => current page. */
  href?: string;
}
