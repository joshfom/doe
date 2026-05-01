import { ProjectInquiryCTA } from "./ProjectInquiryCTA";
import {
  Bed,
  Bath,
  Maximize2,
  Download,
  MapPin,
  Building2,
  Sparkles,
  Calendar,
  Home,
  Wifi,
  Dumbbell,
  Trees,
  Waves,
  Car,
  Shield,
  Coffee,
  Utensils,
  ShoppingBag,
  Phone,
  Mail,
} from "lucide-react";
import { type ProjectLandingData, type Locale, pickMedia } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function pickBilingual(
  en: string | null | undefined,
  ar: string | null | undefined,
  locale: Locale
): string {
  if (locale === "ar") return ar?.trim() || en?.trim() || "";
  return en?.trim() || "";
}

const AMENITY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  home: Home,
  building: Building2,
  wifi: Wifi,
  gym: Dumbbell,
  trees: Trees,
  pool: Waves,
  parking: Car,
  security: Shield,
  cafe: Coffee,
  dining: Utensils,
  retail: ShoppingBag,
  sparkles: Sparkles,
};

function AmenityIcon({ icon, className }: { icon?: string; className?: string }) {
  const Comp = (icon && AMENITY_ICONS[icon]) || Sparkles;
  return <Comp className={className} />;
}

// ── ProjectHero ──────────────────────────────────────────────────────────────

export function ProjectHero({
  data,
  locale,
  overlayOpacity = 0.45,
}: {
  data: ProjectLandingData;
  locale: Locale;
  overlayOpacity?: number;
}) {
  const { project } = data;
  const hero = pickMedia(data, project.heroImageId);
  const logo = pickMedia(data, project.logoImageId);
  const title = pickBilingual(project.nameEn, project.nameAr, locale);
  const subtitle = pickBilingual(
    project.shortDescriptionEn,
    project.shortDescriptionAr,
    locale
  );
  const community = data.community
    ? pickBilingual(data.community.nameEn, data.community.nameAr, locale)
    : "";

  return (
    <section className="relative h-[78vh] min-h-130 w-full overflow-hidden bg-ora-charcoal text-ora-white">
      {hero && (
        <img
          src={hero.url}
          alt={hero.alt || title}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div
        className="absolute inset-0 bg-ora-charcoal"
        style={{ opacity: overlayOpacity }}
      />
      <div className="relative z-10 mx-auto flex h-full max-w-6xl flex-col justify-end px-6 pb-16 md:px-10">
        {logo && (
          <div className="mb-6 h-16 w-auto md:h-20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logo.url}
              alt={logo.alt || `${title} logo`}
              className="h-full w-auto object-contain"
            />
          </div>
        )}
        {community && (
          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-ora-gold">
            {community}
          </p>
        )}
        <h1 className="font-serif text-4xl leading-tight md:text-6xl">{title}</h1>
        {subtitle && (
          <p className="mt-4 max-w-2xl text-base text-ora-white/80 md:text-lg">
            {subtitle}
          </p>
        )}
        <ProjectKeyFacts data={data} locale={locale} />
      </div>
    </section>
  );
}

function ProjectKeyFacts({
  data,
  locale,
}: {
  data: ProjectLandingData;
  locale: Locale;
}) {
  const { project } = data;
  const facts: Array<{ label: string; value: string }> = [];
  const STATUS_LABELS: Record<string, { en: string; ar: string }> = {
    planning: { en: "Planning", ar: "قيد التخطيط" },
    pre_launch: { en: "Pre-Launch", ar: "قبل الإطلاق" },
    selling: { en: "Selling Now", ar: "البيع متاح" },
    under_construction: { en: "Under Construction", ar: "قيد الإنشاء" },
    handover: { en: "Handover", ar: "التسليم" },
    completed: { en: "Completed", ar: "مكتمل" },
  };
  const status = STATUS_LABELS[project.status];
  if (status) facts.push({ label: "", value: status[locale] });
  if (project.expectedHandoverDate) {
    facts.push({
      label: locale === "ar" ? "التسليم" : "Handover",
      value: new Date(project.expectedHandoverDate).toLocaleDateString(
        locale === "ar" ? "ar-AE" : "en-US",
        { year: "numeric", month: "short" }
      ),
    });
  }
  if (typeof project.totalUnits === "number") {
    facts.push({
      label: locale === "ar" ? "الوحدات" : "Units",
      value: String(project.totalUnits),
    });
  }
  if (project.developer) {
    facts.push({
      label: locale === "ar" ? "المطور" : "Developer",
      value: project.developer,
    });
  }
  if (facts.length === 0) return null;
  return (
    <div className="mt-8 flex flex-wrap gap-6 border-t border-ora-white/20 pt-6">
      {facts.map((f, i) => (
        <div key={i} className="text-sm">
          {f.label && (
            <p className="text-[11px] uppercase tracking-wider text-ora-white/60">
              {f.label}
            </p>
          )}
          <p className="font-medium">{f.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── BrochureGallery ──────────────────────────────────────────────────────────

export function BrochureGallery({
  data,
  locale,
}: {
  data: ProjectLandingData;
  locale: Locale;
}) {
  const ids = data.project.brochureGallery ?? [];
  if (ids.length === 0) return null;
  const brochurePdf = pickMedia(data, data.project.brochurePdfId);
  return (
    <section className="bg-ora-cream py-16">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <div className="mb-8 flex items-end justify-between gap-6">
          <h2 className="font-serif text-3xl text-ora-charcoal md:text-4xl">
            {locale === "ar" ? "معرض الصور" : "Gallery"}
          </h2>
          {brochurePdf && (
            <a
              href={brochurePdf.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 border border-ora-charcoal bg-ora-charcoal px-5 text-sm text-ora-white transition-colors hover:bg-ora-graphite"
            >
              <Download className="h-4 w-4 stroke-1" />
              {locale === "ar" ? "تنزيل الكتيب" : "Download Brochure"}
            </a>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {ids.map((id, i) => {
            const m = pickMedia(data, id);
            if (!m) return null;
            return (
              <div
                key={`${id}-${i}`}
                className="relative aspect-4/3 overflow-hidden bg-ora-sand/40"
              >
                <img
                  src={m.url}
                  alt={m.alt}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── FloorplanGrid ────────────────────────────────────────────────────────────

export function FloorplanGrid({
  data,
  locale,
}: {
  data: ProjectLandingData;
  locale: Locale;
}) {
  const list = data.project.floorplans ?? [];
  if (list.length === 0) return null;
  return (
    <section className="bg-ora-white py-16">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <h2 className="mb-8 font-serif text-3xl text-ora-charcoal md:text-4xl">
          {locale === "ar" ? "المخططات الطابقية" : "Floor Plans"}
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((fp, i) => {
            const img = pickMedia(data, fp.imageId);
            const pdf = pickMedia(data, fp.pdfId);
            const name = pickBilingual(fp.nameEn, fp.nameAr, locale) || fp.unitType;
            return (
              <div
                key={i}
                className="border border-ora-sand/60 bg-ora-cream/30 transition-shadow hover:shadow-ora-md"
              >
                <div className="relative aspect-4/3 bg-ora-sand/40">
                  {img && (
                    <img
                      src={img.url}
                      alt={img.alt || name}
                      className="absolute inset-0 h-full w-full object-contain p-3"
                    />
                  )}
                </div>
                <div className="p-5">
                  <h3 className="text-lg font-medium text-ora-charcoal">
                    {name}
                  </h3>
                  <p className="text-xs uppercase tracking-wider text-ora-muted">
                    {fp.unitType}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-4 text-sm text-ora-charcoal-light">
                    {typeof fp.bedrooms === "number" && (
                      <span className="inline-flex items-center gap-1.5">
                        <Bed className="h-4 w-4 stroke-1" />
                        {fp.bedrooms}
                      </span>
                    )}
                    {typeof fp.bathrooms === "number" && (
                      <span className="inline-flex items-center gap-1.5">
                        <Bath className="h-4 w-4 stroke-1" />
                        {fp.bathrooms}
                      </span>
                    )}
                    {typeof fp.areaSqm === "number" && (
                      <span className="inline-flex items-center gap-1.5">
                        <Maximize2 className="h-4 w-4 stroke-1" />
                        {fp.areaSqm} m²
                      </span>
                    )}
                  </div>
                  {pdf && (
                    <a
                      href={pdf.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-5 inline-flex items-center gap-1.5 border-b border-ora-gold pb-0.5 text-xs font-medium uppercase tracking-wider text-ora-gold hover:text-ora-charcoal"
                    >
                      <Download className="h-3 w-3 stroke-1" />
                      {locale === "ar" ? "تنزيل PDF" : "Download PDF"}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── AmenitiesGrid ────────────────────────────────────────────────────────────

export function AmenitiesGrid({
  data,
  locale,
}: {
  data: ProjectLandingData;
  locale: Locale;
}) {
  const list = data.project.amenities ?? [];
  if (list.length === 0) return null;
  return (
    <section className="bg-ora-cream py-16">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <h2 className="mb-8 font-serif text-3xl text-ora-charcoal md:text-4xl">
          {locale === "ar" ? "المرافق" : "Amenities"}
        </h2>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((a, i) => {
            const name = pickBilingual(a.nameEn, a.nameAr, locale);
            const desc = pickBilingual(a.descriptionEn, a.descriptionAr, locale);
            return (
              <div key={i} className="text-center">
                <div className="mx-auto mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full border border-ora-gold/40 bg-ora-white text-ora-gold">
                  <AmenityIcon icon={a.icon} className="h-6 w-6 stroke-1" />
                </div>
                <h3 className="text-sm font-medium text-ora-charcoal">{name}</h3>
                {desc && (
                  <p className="mt-1 text-xs text-ora-charcoal-light">{desc}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── LocationHighlights ───────────────────────────────────────────────────────

export function LocationHighlights({
  data,
  locale,
}: {
  data: ProjectLandingData;
  locale: Locale;
}) {
  const list = data.project.locationHighlights ?? [];
  if (list.length === 0) return null;
  return (
    <section className="bg-ora-white py-16">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <h2 className="mb-8 font-serif text-3xl text-ora-charcoal md:text-4xl">
          {locale === "ar" ? "الموقع" : "Location"}
        </h2>
        <ul className="divide-y divide-ora-sand/60 border-y border-ora-sand/60">
          {list.map((h, i) => {
            const title = pickBilingual(h.titleEn, h.titleAr, locale);
            return (
              <li
                key={i}
                className="flex items-center justify-between gap-4 py-4"
              >
                <span className="inline-flex items-center gap-3 text-ora-charcoal">
                  <MapPin className="h-4 w-4 stroke-1 text-ora-gold" />
                  {title}
                </span>
                {typeof h.distanceKm === "number" && (
                  <span className="text-sm tabular-nums text-ora-charcoal-light">
                    {h.distanceKm} km
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// ── PaymentPlanTable ─────────────────────────────────────────────────────────

export function PaymentPlanTable({
  data,
  locale,
}: {
  data: ProjectLandingData;
  locale: Locale;
}) {
  const plans = data.project.paymentPlans ?? [];
  if (plans.length === 0) return null;
  return (
    <section className="bg-ora-cream py-16">
      <div className="mx-auto max-w-6xl px-6 md:px-10">
        <h2 className="mb-8 font-serif text-3xl text-ora-charcoal md:text-4xl">
          {locale === "ar" ? "خطط الدفع" : "Payment Plans"}
        </h2>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {plans.map((plan, i) => {
            const name = pickBilingual(plan.nameEn, plan.nameAr, locale);
            const totalMilestonePct = plan.milestones.reduce(
              (acc, m) => acc + (m.pct || 0),
              0
            );
            return (
              <div key={i} className="border border-ora-sand/60 bg-ora-white p-6">
                <div className="mb-4 flex items-baseline justify-between">
                  <h3 className="text-lg font-medium text-ora-charcoal">{name}</h3>
                  {typeof plan.downPaymentPct === "number" && (
                    <span className="text-xs uppercase tracking-wider text-ora-gold">
                      {plan.downPaymentPct}%{" "}
                      {locale === "ar" ? "دفعة أولى" : "down"}
                    </span>
                  )}
                </div>
                <ul className="space-y-2 text-sm">
                  {plan.milestones.map((m, j) => (
                    <li
                      key={j}
                      className="flex items-center justify-between gap-3 border-b border-ora-sand/60 pb-2 last:border-0"
                    >
                      <span className="text-ora-charcoal-light">
                        {pickBilingual(m.labelEn, m.labelAr, locale)}
                      </span>
                      <span className="font-medium tabular-nums text-ora-charcoal">
                        {m.pct}%
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[11px] uppercase tracking-wider text-ora-muted">
                  {locale === "ar" ? "إجمالي" : "Total"}: {totalMilestonePct}%
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── ProjectOverview (long description) ───────────────────────────────────────

type ProseBlock =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseProseBody(raw: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  const segments = raw.replace(/\r\n/g, "\n").split(/\n{2,}/);

  for (const segment of segments) {
    const lines = segment.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const allBullets = lines.every((l) => /^[-*•]\s+/.test(l));
    const allNumbered = lines.every((l) => /^\d+[.)]\s+/.test(l));

    if (allBullets) {
      blocks.push({
        kind: "ul",
        items: lines.map((l) => l.replace(/^[-*•]\s+/, "")),
      });
    } else if (allNumbered) {
      blocks.push({
        kind: "ol",
        items: lines.map((l) => l.replace(/^\d+[.)]\s+/, "")),
      });
    } else {
      blocks.push({ kind: "p", lines });
    }
  }
  return blocks;
}

function ProseBody({ raw }: { raw: string }) {
  const blocks = parseProseBody(raw);
  return (
    <div className="space-y-4 text-base leading-relaxed text-ora-charcoal-light">
      {blocks.map((b, i) => {
        if (b.kind === "p") {
          return (
            <p key={i}>
              {b.lines.map((line, j) => (
                <span key={j}>
                  {line}
                  {j < b.lines.length - 1 && <br />}
                </span>
              ))}
            </p>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={i} className="ms-5 list-disc space-y-1">
              {b.items.map((it, j) => (
                <li key={j}>{it}</li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={i} className="ms-5 list-decimal space-y-1">
            {b.items.map((it, j) => (
              <li key={j}>{it}</li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}

export function ProjectOverview({
  data,
  locale,
}: {
  data: ProjectLandingData;
  locale: Locale;
}) {
  const body = pickBilingual(
    data.project.longDescriptionEn,
    data.project.longDescriptionAr,
    locale
  );
  if (!body) return null;
  return (
    <section className="bg-ora-white py-16">
      <div className="mx-auto max-w-3xl px-6 md:px-10">
        <h2 className="mb-6 font-serif text-3xl text-ora-charcoal md:text-4xl">
          {locale === "ar" ? "نظرة عامة" : "Overview"}
        </h2>
        <ProseBody raw={body} />
      </div>
    </section>
  );
}

// ── ProjectContactCTA ────────────────────────────────────────────────────────

export function ProjectContactCTA({
  data,
  locale,
  settings,
}: {
  data: ProjectLandingData;
  locale: Locale;
  settings: Record<string, string>;
}) {
  const phone = settings.phone?.trim();
  const email = settings.email?.trim();
  const company = settings.company_name?.trim();
  if (!phone && !email) return null;
  const projectName = pickBilingual(
    data.project.nameEn,
    data.project.nameAr,
    locale
  );
  const subjectEn = `Inquiry about ${projectName}`;
  const subjectAr = `استفسار بخصوص ${projectName}`;
  const mailto = email
    ? `mailto:${email}?subject=${encodeURIComponent(
        locale === "ar" ? subjectAr : subjectEn
      )}`
    : null;
  return (
    <section className="bg-ora-charcoal py-16 text-ora-white">
      <div className="mx-auto max-w-4xl px-6 text-center md:px-10">
        <h2 className="font-serif text-3xl md:text-4xl">
          {locale === "ar"
            ? "هل أنت مهتم بهذا المشروع؟"
            : "Interested in this project?"}
        </h2>
        <p className="mt-4 text-base text-ora-white/80">
          {locale === "ar"
            ? `تواصل مع فريق ${company || "المبيعات"} للحصول على مزيد من المعلومات.`
            : `Get in touch with the ${company || "sales"} team for more information.`}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          {phone && (
            <a
              href={`tel:${phone.replace(/\s+/g, "")}`}
              className="inline-flex h-11 items-center gap-2 border border-ora-gold bg-ora-gold px-6 text-sm font-medium text-ora-charcoal transition-colors hover:bg-transparent hover:text-ora-gold"
            >
              <Phone className="h-4 w-4 stroke-1" />
              {phone}
            </a>
          )}
          {mailto && (
            <a
              href={mailto}
              className="inline-flex h-11 items-center gap-2 border border-ora-white/40 px-6 text-sm font-medium text-ora-white transition-colors hover:border-ora-gold hover:text-ora-gold"
            >
              <Mail className="h-4 w-4 stroke-1" />
              {locale === "ar" ? "أرسل استفساراً" : "Send Inquiry"}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Default Composition ──────────────────────────────────────────────────────

export function ProjectLanding({
  data,
  locale,
  settings,
}: {
  data: ProjectLandingData;
  locale: Locale;
  settings?: Record<string, string>;
}) {
  return (
    <main dir={locale === "ar" ? "rtl" : "ltr"}>
      <ProjectHero data={data} locale={locale} />
      <ProjectOverview data={data} locale={locale} />
      <BrochureGallery data={data} locale={locale} />
      <FloorplanGrid data={data} locale={locale} />
      <AmenitiesGrid data={data} locale={locale} />
      <LocationHighlights data={data} locale={locale} />
      <PaymentPlanTable data={data} locale={locale} />
      {settings && (
        <ProjectInquiryCTA data={data} locale={locale} settings={settings} />
      )}
    </main>
  );
}
