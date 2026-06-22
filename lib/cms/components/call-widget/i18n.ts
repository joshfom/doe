/**
 * DOE Call Widget — localized strings (en / ar).
 *
 * Kept in a dedicated module so the widget stays self-contained and the same
 * strings can be reused by the in-call UI added in a later task (§7.1).
 */

export interface CallWidgetStrings {
  /** Label on the floating action button and hero CTA. */
  cta: string;
  /** Accessible label for the floating button. */
  openLabel: string;
  /** Pre-call modal heading. */
  formTitle: string;
  /** Short reassurance line under the heading. */
  formSubtitle: string;
  phoneLabel: string;
  emailLabel: string;
  nameLabel: string;
  /** Hint shown next to the optional name field. */
  nameOptional: string;
  consentLabel: string;
  /** Error shown when the caller submits without checking consent. */
  consentRequired: string;
  submit: string;
  close: string;
  invalidPhone: string;
  invalidEmail: string;
  privacyNote: string;
  privacyLinkLabel: string;
}

export const callWidgetI18n: Record<"en" | "ar", CallWidgetStrings> = {
  en: {
    cta: "Call DOE",
    openLabel: "Call DOE — start a voice call",
    formTitle: "Talk to DOE",
    formSubtitle:
      "Enter your details and we'll connect you to a live voice assistant about ORA projects.",
    phoneLabel: "Phone",
    emailLabel: "Email",
    nameLabel: "Name",
    nameOptional: "Optional",
    consentLabel:
      "I consent to being contacted about ORA projects and to this call being processed.",
    consentRequired: "Please accept the consent notice to start the call.",
    submit: "Start call",
    close: "Close",
    invalidPhone: "Please enter a valid phone number.",
    invalidEmail: "Please enter a valid email address.",
    privacyNote: "For details on how we handle your personal data, please review our",
    privacyLinkLabel: "Privacy Policy",
  },
  ar: {
    cta: "اتصل بـ DOE",
    openLabel: "اتصل بـ DOE — ابدأ مكالمة صوتية",
    formTitle: "تحدّث إلى DOE",
    formSubtitle:
      "أدخل بياناتك وسنوصلك بمساعد صوتي مباشر للحديث عن مشاريع ORA.",
    phoneLabel: "الهاتف",
    emailLabel: "البريد الإلكتروني",
    nameLabel: "الاسم",
    nameOptional: "اختياري",
    consentLabel:
      "أوافق على أن يتم التواصل معي بشأن مشاريع ORA وعلى معالجة هذه المكالمة.",
    consentRequired: "يرجى الموافقة على إشعار الموافقة لبدء المكالمة.",
    submit: "ابدأ المكالمة",
    close: "إغلاق",
    invalidPhone: "يرجى إدخال رقم هاتف صحيح.",
    invalidEmail: "يرجى إدخال بريد إلكتروني صحيح.",
    privacyNote: "لمعرفة كيفية تعاملنا مع بياناتك الشخصية، يرجى مراجعة",
    privacyLinkLabel: "سياسة الخصوصية",
  },
};
