/**
 * Footer configuration types.
 * Stored in siteSettings as JSON under key "footer_config_en" or "footer_config_ar".
 */

export interface FooterLink {
  label: string;
  url: string;
  /** Anchor target. Defaults to _self. */
  target?: "_self" | "_blank";
  /** Optional rel attribute. Auto-applied for _blank links. */
  rel?: string;
}

/**
 * Visual theme for the footer. All colors are CSS color strings (hex, rgb, etc.).
 * Stored with the config so content editors can tune the footer without touching code.
 */
export interface FooterTheme {
  background: string;
  text: string;
  /** Group headings, recruitment label, newsletter label, link hover. */
  accent: string;
  /** Top-level section headings (SITEMAP, PROPERTIES…). */
  sectionHeading: string;
  /** Horizontal rules and top/bottom borders. */
  border: string;
  /** Color used on link hover. Usually matches accent. */
  linkHover: string;
}

/**
 * A sub-group of links within a section. The optional `name` renders as a
 * colored sub-heading (e.g., "EGYPT", "IRAQ"). When omitted the links render
 * flat with no sub-heading.
 */
export interface FooterLinkGroup {
  name?: string;
  links: FooterLink[];
}

export interface FooterSection {
  name: string;
  /** Flat links. Used when the section has no sub-groups. */
  links?: FooterLink[];
  /** Sub-groups of links (mutually exclusive with `links`). */
  groups?: FooterLinkGroup[];
  /** Visual column span on desktop (1 or 2). Defaults to 1. */
  columnSpan?: 1 | 2;
}

export interface FooterSocial {
  platform: string; // "twitter", "linkedin", "instagram", "facebook", "youtube", "x"
  icon: string;
  url: string;
  target?: "_self" | "_blank";
}

export interface FooterConfig {
  sections: FooterSection[];
  recruitment: {
    email: string;
    text: string;
  };
  newsletter: {
    enabled: boolean;
    label: string;
    placeholder: string;
  };
  socials: FooterSocial[];
  /** Links rendered in the bottom bar (Cookie Policy, Terms, Privacy…). */
  legalLinks: FooterLink[];
  /** Copyright / rights-reserved text shown on the bottom bar. */
  legal: string;
  backToTopLabel: string;
  /** Whether to show the "Download Brochure" button in the right column. */
  showBrochureButton?: boolean;
  brochureLabel?: string;
  brochureUrl?: string;
  /** Optional visual overrides. Falls back to DEFAULT_FOOTER_THEME when absent. */
  theme?: FooterTheme;
  locale: "en" | "ar";
  updatedAt: string;
}

export const DEFAULT_FOOTER_THEME: FooterTheme = {
  background: "#FAFAF7",
  text: "#333333",
  accent: "#01A7C7",
  sectionHeading: "#4A4A4A",
  border: "#B8E7F6",
  linkHover: "#01A7C7",
};

/**
 * Default footer configuration for English.
 */
export const DEFAULT_FOOTER_CONFIG_EN: FooterConfig = {
  locale: "en",
  sections: [
    {
      name: "Sitemap",
      columnSpan: 1,
      links: [
        { label: "About ORA", url: "/about" },
        { label: "Property Types", url: "/property-types" },
        { label: "Life at Bayn", url: "/life-at-bayn" },
        { label: "Why Bayn", url: "/why-bayn" },
        { label: "Contact Us", url: "/contact" },
        { label: "Register Interest", url: "/register-interest" },
      ],
    },
    {
      name: "Properties",
      columnSpan: 2,
      groups: [
        {
          name: "Egypt",
          links: [
            { label: "ZED East", url: "/properties/zed-east" },
            { label: "ZED ElSheikh Zayed", url: "/properties/zed-elsheikh-zayed" },
            { label: "Silversands North Coast", url: "/properties/silversands-north-coast" },
            { label: "Solana by ORA", url: "/properties/solana" },
            { label: "Pyramid Hills", url: "/properties/pyramid-hills" },
          ],
        },
        {
          name: "Cyprus",
          links: [{ label: "Ayia Napa Marina", url: "/properties/ayia-napa-marina" }],
        },
        {
          name: "Iraq",
          links: [{ label: "Madinat Al Ward", url: "/properties/madinat-al-ward" }],
        },
        {
          name: "Pakistan",
          links: [{ label: "Eighteen", url: "/properties/eighteen" }],
        },
        {
          name: "Grenada",
          links: [{ label: "Silversands Villas", url: "/properties/silversands-villas" }],
        },
      ],
    },
    {
      name: "Hospitality",
      columnSpan: 2,
      groups: [
        {
          name: "Grenada",
          links: [
            { label: "Silversands Grand Anse", url: "/hospitality/silversands-grand-anse" },
            { label: "Silversands Beach House", url: "/hospitality/silversands-beach-house" },
            { label: "Merveilles Entertainment Hub", url: "/hospitality/merveilles" },
          ],
        },
        {
          name: "Greece",
          links: [{ label: "Mykonos", url: "/hospitality/mykonos" }],
        },
      ],
    },
  ],
  recruitment: {
    email: "careers@ora-uae.com",
    text: "For Recruitment",
  },
  newsletter: {
    enabled: true,
    label: "Subscribe to our Newsletter",
    placeholder: "Email",
  },
  socials: [
    { platform: "facebook", icon: "facebook", url: "https://facebook.com" },
    { platform: "instagram", icon: "instagram", url: "https://instagram.com" },
    { platform: "x", icon: "x", url: "https://x.com" },
    { platform: "youtube", icon: "youtube", url: "https://youtube.com" },
  ],
  legalLinks: [
    { label: "Cookie Policy", url: "/cookie-policy" },
    { label: "Terms & Conditions", url: "/terms" },
    { label: "Privacy Policy", url: "/privacy-policy" },
  ],
  legal: "© ORA 2026. All rights reserved.",
  backToTopLabel: "Back to Top",
  showBrochureButton: true,
  brochureLabel: "Download Brochure",
  brochureUrl: "#",
  theme: DEFAULT_FOOTER_THEME,
  updatedAt: new Date().toISOString(),
};

/**
 * Default footer configuration for Arabic.
 */
export const DEFAULT_FOOTER_CONFIG_AR: FooterConfig = {
  locale: "ar",
  sections: [
    {
      name: "خريطة الموقع",
      columnSpan: 1,
      links: [
        { label: "عن ORA", url: "/ar/about" },
        { label: "أنواع العقارات", url: "/ar/property-types" },
        { label: "الحياة في باين", url: "/ar/life-at-bayn" },
        { label: "لماذا باين", url: "/ar/why-bayn" },
        { label: "اتصل بنا", url: "/ar/contact" },
        { label: "سجل اهتمامك", url: "/ar/register-interest" },
      ],
    },
    {
      name: "العقارات",
      columnSpan: 2,
      groups: [
        {
          name: "مصر",
          links: [
            { label: "زد إيست", url: "/ar/properties/zed-east" },
            { label: "زد الشيخ زايد", url: "/ar/properties/zed-elsheikh-zayed" },
            { label: "سيلفرساندز الساحل الشمالي", url: "/ar/properties/silversands-north-coast" },
            { label: "سولانا من ORA", url: "/ar/properties/solana" },
            { label: "بيراميد هيلز", url: "/ar/properties/pyramid-hills" },
          ],
        },
        {
          name: "قبرص",
          links: [{ label: "أيا نابا مارينا", url: "/ar/properties/ayia-napa-marina" }],
        },
        {
          name: "العراق",
          links: [{ label: "مدينة الورد", url: "/ar/properties/madinat-al-ward" }],
        },
        {
          name: "باكستان",
          links: [{ label: "إيتين", url: "/ar/properties/eighteen" }],
        },
        {
          name: "غرينادا",
          links: [{ label: "سيلفرساندز فيلات", url: "/ar/properties/silversands-villas" }],
        },
      ],
    },
    {
      name: "الضيافة",
      columnSpan: 2,
      groups: [
        {
          name: "غرينادا",
          links: [
            { label: "سيلفرساندز غراند آنس", url: "/ar/hospitality/silversands-grand-anse" },
            { label: "سيلفرساندز بيتش هاوس", url: "/ar/hospitality/silversands-beach-house" },
            { label: "مرفيل للترفيه", url: "/ar/hospitality/merveilles" },
          ],
        },
        {
          name: "اليونان",
          links: [{ label: "ميكونوس", url: "/ar/hospitality/mykonos" }],
        },
      ],
    },
  ],
  recruitment: {
    email: "careers@ora-uae.com",
    text: "للتوظيف",
  },
  newsletter: {
    enabled: true,
    label: "اشترك في نشرتنا الإخبارية",
    placeholder: "البريد الإلكتروني",
  },
  socials: [
    { platform: "facebook", icon: "facebook", url: "https://facebook.com" },
    { platform: "instagram", icon: "instagram", url: "https://instagram.com" },
    { platform: "x", icon: "x", url: "https://x.com" },
    { platform: "youtube", icon: "youtube", url: "https://youtube.com" },
  ],
  legalLinks: [
    { label: "سياسة ملفات تعريف الارتباط", url: "/ar/cookie-policy" },
    { label: "الشروط والأحكام", url: "/ar/terms" },
    { label: "سياسة الخصوصية", url: "/ar/privacy-policy" },
  ],
  legal: "© ORA 2026. جميع الحقوق محفوظة.",
  backToTopLabel: "العودة إلى الأعلى",
  showBrochureButton: true,
  brochureLabel: "تحميل الكتيب",
  brochureUrl: "#",
  theme: DEFAULT_FOOTER_THEME,
  updatedAt: new Date().toISOString(),
};
