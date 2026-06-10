/**
 * Components exempt from the responsiveDefaults.mobile requirement.
 * Each entry must have a non-empty justification string explaining why
 * the component has no multi-column behavior and does not need mobile stacking defaults.
 */
export const RESPONSIVE_DEFAULTS_EXEMPT: Record<string, string> = {
  Section:
    "Section is a full-width wrapper with background styling — it contains a single slot and has no multi-column layout.",
  Container:
    "Container constrains content width and provides background styling — it renders a single slot with no horizontal item arrangement.",
  Accordion:
    "Accordion is a single collapsible panel — it renders one content slot vertically with no side-by-side layout.",
  Spacer:
    "Spacer is a single empty div used for vertical spacing — it has no layout direction or child arrangement.",
  Divider:
    "Divider is a horizontal rule element with no multi-column behavior.",
  Heading:
    "Heading renders a single text element — it has no children arranged horizontally.",
  Text:
    "Text renders a single rich-text block — it has no multi-column layout.",
  Button:
    "Button renders a single interactive element — it has no child arrangement.",
  InlineLink:
    "InlineLink renders a single anchor element — it has no layout behavior.",
  Image:
    "Image renders a single media element — it has no multi-column layout.",
  Video:
    "Video renders a single embedded player — it has no child arrangement.",
  Quote:
    "Quote renders a single blockquote element — it has no horizontal layout.",
  Icon:
    "Icon renders a single SVG element — it has no multi-column behavior.",
  ImageCarousel:
    "ImageCarousel displays items one at a time in a slider — items are never arranged side-by-side.",
  Gallery:
    "Gallery manages its own responsive grid/carousel layout internally — column count is a user-configurable prop.",
  FilterTabs:
    "FilterTabs renders a single row of tab buttons followed by filtered content — it has no multi-column grid layout.",
  ScrollIndicator:
    "ScrollIndicator is a single UI element for scroll progress — it has no child arrangement.",
  LocationMap:
    "LocationMap renders a single embedded map — it has no multi-column layout.",
  ProjectSection:
    "ProjectSection renders a single project detail view — it has no side-by-side item arrangement.",
  ExperienceLauncher:
    "ExperienceLauncher renders a single interactive launcher element — it has no multi-column behavior.",
  CTA:
    "CTA renders a single conversion band (heading, subtext, and one or two buttons) — it has no multi-column item grid that needs mobile stacking.",
  TabGroup:
    "TabGroup renders a single tab list above one visible panel slot — tabs and panels stack inherently and there is no multi-column item grid to collapse on mobile.",
  Card:
    "Card renders a single content card (image, title, body, optional CTA) — it has no multi-column item arrangement of its own; grid layout is provided by the CardGrid wrapper.",
  SocialLinks:
    "SocialLinks renders a single inline row of social icons that wraps naturally — it has no breakpoint-aware column grid that needs mobile stacking.",
  Countdown:
    "Countdown renders a single live countdown value/expiry message — it has no multi-column item layout.",
  Breadcrumbs:
    "Breadcrumbs renders a single inline ordered list of links that wraps naturally — it has no multi-column grid that needs mobile stacking.",
};
