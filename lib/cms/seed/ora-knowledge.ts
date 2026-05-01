/**
 * Curated knowledge-base content for the AI to retrieve.
 * Sourced from ora-uae.com (the public Bayn / ORA Developers website) on 2026-05-01,
 * lightly edited for clarity. Each entry seeds one row in `knowledge_documents` and
 * is re-embedded via the "Re-embed All" admin action when the AI gateway is
 * configured. `sourceRefId` is the stable id used for upsert + safe reset.
 */

export interface SeedKnowledgeDoc {
  sourceRefId: string;
  title: string;
  content: string;
  sourceType: "manual" | "blog_sync" | "construction_update" | "faq" | "policy";
  category: string | null;
  locale: "en" | "ar";
}

export const ORA_KNOWLEDGE_DOCS: SeedKnowledgeDoc[] = [
  {
    sourceRefId: "demo:ora:about",
    title: "About ORA Developers",
    sourceType: "manual",
    category: "company",
    locale: "en",
    content: `ORA Developers is a global developer and curator of lifestyle destinations, led by Chairman and CEO Eng. Naguib Sawiris. ORA's vision — captured in the brand line "Reimagining Time" — is to create design-led, emotionally resonant communities that are timeless, soulful, and rooted in harmony with nature.

ORA's three core values are Excellence, Balance, and Happiness. Every project is curated to be self-sufficient and fully integrated, regardless of scale, with a deep respect for the natural environment and a commitment to sustainable luxury living.

ORA's global footprint spans the UAE, Egypt, Iraq, Cyprus, Pakistan, Greece, and Grenada, with developments delivered in partnership with established global names. In the UAE, ORA's flagship community is Bayn — delivered in partnership with MODON.`,
  },
  {
    sourceRefId: "demo:ora:portfolio",
    title: "ORA Global Portfolio",
    sourceType: "manual",
    category: "company",
    locale: "en",
    content: `ORA's global portfolio includes:

UAE — Bayn (Ghantoot, beachfront master community delivered with MODON).
Egypt — ZED Sheikh Zayed, ZED East, Silversands North Coast, Solana by ORA, Pyramid Hills.
Iraq — Madinat Al Ward.
Cyprus — Ayia Napa Marina.
Pakistan — Eighteen.
Grenada — Silversands Villas.

Hospitality assets include Silversands Grand Anse and Silversands Beach House (Grenada), Merveilles Entertainment Hub (Grenada), and Mykonos (Greece). For UAE inquiries, the Bayn community is the primary residential offering.`,
  },
  {
    sourceRefId: "demo:bayn:overview",
    title: "Bayn — First Home Beach Community",
    sourceType: "manual",
    category: "community",
    locale: "en",
    content: `Bayn is ORA's flagship UAE community — the first home beach community in Ghantoot, on the coast between Dubai and Abu Dhabi. The master plan covers a total land area of 4.8 million square metres, of which 55% is dedicated to open spaces and parks. Bayn is designed for approximately 32,000 residents across roughly 9,000 units, with 1.2 km of beachfront, 1 million square metres of public parks, a five-star resort, and 7.1 km of walkable spaces.

Bayn is a self-contained, walkable beachfront community where residents have everything within reach — morning swims, evening strolls, retail, dining, schools, and wellness. The brand promise is balance: vibrancy and tranquility, energy and ease, connection and privacy. Bayn is delivered by ORA Developers in partnership with MODON.`,
  },
  {
    sourceRefId: "demo:bayn:location",
    title: "Bayn — Location & Access",
    sourceType: "manual",
    category: "community",
    locale: "en",
    content: `Bayn is located in Ghantoot, on the UAE coast between Dubai and Abu Dhabi. Approximate drive times from Bayn:

- Palm Jebel Ali — 7 minutes
- Dubai Marina — 20 minutes
- DWC (Al Maktoum) Airport — 25 minutes
- Downtown Dubai — 35 minutes
- Abu Dhabi — 45 minutes

The location gives residents seamless access to both Dubai and Abu Dhabi while preserving an uninterrupted beachfront sanctuary. A Bayn 3D tour and downloadable brochure are available on the official ORA UAE website.`,
  },
  {
    sourceRefId: "demo:bayn:lifestyle",
    title: "Bayn — Lifestyle & Vision",
    sourceType: "manual",
    category: "community",
    locale: "en",
    content: `Bayn's vision is "an integrated community where lifestyle, location, and design come together effortlessly." It is designed for limitless movement, connection, and balance — a beachfront sanctuary where you don't have to choose between vibrancy and tranquility.

Lifestyle pillars at Bayn:
- Beachfront living with 1.2 km of private coastline.
- 55% open space, 1M sqm of public parks, and 7.1 km of pedestrian-first walkable spaces.
- A five-star resort and curated retail, dining, and wellness.
- Self-contained design — schools, healthcare, and daily essentials are inside the community.
- A masterplan that respects the natural surroundings and prioritises sustainability.

Bayn is positioned as ORA's "First Home Beach Community" — built for primary residents, not just second-home owners.`,
  },
  {
    sourceRefId: "demo:bayn:contact",
    title: "Contacting ORA & Bayn",
    sourceType: "policy",
    category: "support",
    locale: "en",
    content: `ORA Developers — UAE inquiries:
- Sales and information about Bayn: use the inquiry form on the official website or speak with the ORA AI assistant in the bottom-right of the site.
- Brochure downloads (Bayn and ORA corporate) are available from ora-uae.com.
- Recruitment: careers@ora-uae.com.
- Social: @baynuae on Facebook, Instagram, X (Twitter), and YouTube.

For account-specific information (your unit, payments, handover dates, construction progress), the AI assistant will request a one-time password (OTP) sent to your registered email before disclosing any personal data. This protects your account against impersonation.`,
  },
  {
    sourceRefId: "demo:permits:overview",
    title: "Move-in, Move-out, and Gate-pass Permits",
    sourceType: "policy",
    category: "permits",
    locale: "en",
    content: `Bayn residents and their authorised contractors can request the following permits through the ORA support system. Each request is reviewed and approved by a human team member; you will receive an email with the outcome and any scheduled date/time windows.

- Move-in permit: required before any residential move-in. Provide the move date, mover company, truck plate numbers, crew size, and the access route inside the community.
- Move-out permit: same requirements as move-in, with proof of unit clearance.
- Gate pass: for visitors, deliveries, contractors, or vendors. Provide visitor details, vehicle, validity window, purpose, and whether multiple entries are needed.
- Construction material delivery: contractors deliver materials with a vendor profile, materials list (with quantities), delivery date and time window, vehicle details, and whether a lift is required.
- Vendor access: ongoing access for service vendors with vehicles, crew, and an insurance certificate.
- NOC (No Objection Certificate): required for fit-out, renovation, modification, or utility connection. Provide the work description, contractor, planned start/end dates, and estimated cost.

Contractors do not need an existing ORA account to submit a request — the AI will collect the information across the chat and submit a ticket. The owner of the unit is notified and the team will follow up by email.`,
  },
  {
    sourceRefId: "demo:maintenance:overview",
    title: "Maintenance & Technician Requests",
    sourceType: "policy",
    category: "maintenance",
    locale: "en",
    content: `Residents can request a technician visit for AC, plumbing, electrical, carpentry, appliance, pest-control, or general issues through the ORA support channels. Provide:

- Unit number and the area of the home affected (kitchen, bathroom, bedroom, living room, balcony, common area, exterior).
- A short description of the issue and severity (cosmetic, minor, major, emergency).
- Photos when possible — these speed up triage.
- A preferred visit window.

Emergency requests are prioritised. Where the unit is still under warranty, the request is routed accordingly. The AI assistant can open a ticket on your behalf and confirm the assigned visit window by email.`,
  },
  {
    sourceRefId: "demo:payments:policy",
    title: "Payments & Anti-fraud Policy",
    sourceType: "policy",
    category: "payments",
    locale: "en",
    content: `All ORA payments — for units, fees, and services — are made exclusively through official ORA payment channels. ORA will NEVER:

- Ask you to send payment to a personal wallet, crypto address, or unrelated bank account.
- Request payment over chat, SMS, or social DM links from unverified senders.
- Pressure you with same-day urgency to avoid a "lost slot."

If you are ever asked to do any of the above, treat it as fraud and report it to ORA support immediately. The AI assistant will never quote final prices or close a transaction in chat — it will hand you off to a human ORA representative for verified payment guidance.

For official balance, milestone, and payment-plan information, the AI assistant will require OTP verification before disclosing your account details.`,
  },
  // Arabic counterpart for the most-asked entries.
  {
    sourceRefId: "demo:bayn:overview:ar",
    title: "بيـن — مجتمع شاطئي للسكن الأول",
    sourceType: "manual",
    category: "community",
    locale: "ar",
    content: `بيـن هو المجتمع الرائد لشركة ORA في دولة الإمارات — أول مجتمع شاطئي للسكن الأول في غنتوت، على الساحل بين دبي وأبوظبي. تبلغ المساحة الإجمالية للمخطط الرئيسي 4.8 مليون متر مربع، خُصص 55% منها للمساحات المفتوحة والحدائق العامة. يستوعب المجتمع نحو 32,000 ساكن في 9,000 وحدة تقريباً، مع 1.2 كم من الواجهة البحرية، ومليون متر مربع من الحدائق العامة، ومنتجع خمس نجوم، و7.1 كم من المسارات المخصصة للمشاة.

بيـن هو مجتمع شاطئي مكتفٍ ذاتياً قابل للمشي، حيث يجد السكان كل ما يحتاجونه في مكان واحد — السباحة الصباحية، التجزئة، المطاعم، المدارس، والعافية. الوعد العلامي هو التوازن: حيوية وهدوء، طاقة وراحة، تواصل وخصوصية. تطوّر بيـن من قِبَل ORA Developers بالشراكة مع MODON.`,
  },
  {
    sourceRefId: "demo:permits:overview:ar",
    title: "تصاريح الانتقال، الخروج، وبوابة الدخول",
    sourceType: "policy",
    category: "permits",
    locale: "ar",
    content: `يستطيع سكان بيـن والمقاولون المعتمدون منهم طلب التصاريح التالية عبر منظومة الدعم في ORA. تتم مراجعة كل طلب من قبل أحد أعضاء الفريق ويتم اعتماده، وستصلك رسالة بريد إلكتروني تتضمن النتيجة والمواعيد المحددة.

- تصريح الانتقال للسكن: مطلوب قبل أي نقل أثاث. يُرجى تزويدنا بتاريخ النقل، اسم شركة النقل، أرقام لوحات الشاحنات، عدد الفريق، ومسار الدخول.
- تصريح الخروج: نفس متطلبات تصريح الانتقال للسكن مع شهادة إخلاء الوحدة.
- تصريح بوابة (Gate Pass): للزوار، التوصيل، المقاولين، أو الموردين. يشمل بيانات الزائر، المركبة، فترة الصلاحية، الغرض، وعدد مرات الدخول.
- توصيل مواد البناء: يقدمها المقاولون مع بيانات المورد، قائمة المواد بالكميات، تاريخ ووقت التسليم، بيانات المركبة، وتوضيح حاجة استخدام مصعد.
- دخول الموردين: للوصول المتكرر مع المركبات والفريق وشهادة التأمين.
- شهادة عدم ممانعة (NOC): مطلوبة لأي تجهيز داخلي أو تجديد أو تعديل أو ربط خدمات مرافق.

لا يحتاج المقاولون إلى حساب ORA مسبق لتقديم الطلب — سيقوم المساعد الذكي بجمع المعلومات وفتح تذكرة، وسيتابع الفريق بالبريد الإلكتروني.`,
  },
];
