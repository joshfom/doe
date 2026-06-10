import Link from "next/link";

interface NotFoundHeroProps {
  locale: 'en' | 'ar';
}

const content = {
  en: {
    headline: 'Sorry, that page could not be found',
    subtitle: "The requested page either doesn't exist or you don't have access to it.",
    cta: 'Go Back Home',
    ctaHref: '/',
  },
  ar: {
    headline: 'عذراً، لم يتم العثور على هذه الصفحة',
    subtitle: 'الصفحة المطلوبة غير موجودة أو ليس لديك صلاحية الوصول إليها.',
    cta: 'العودة للرئيسية',
    ctaHref: '/ar',
  },
};

export function NotFoundHero({ locale }: NotFoundHeroProps) {
  return (
    <section className="flex flex-col items-center justify-center min-h-[calc(100vh-160px)] px-4 sm:px-6 py-20 sm:py-28 lg:py-32 text-center">
      <div className="w-full max-w-[80%] sm:max-w-[60%] lg:max-w-[600px] mb-10 sm:mb-12">
        <svg viewBox="0 0 800 400" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="gradient-sand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E8E4DF" />
              <stop offset="100%" stopColor="#D4CFC8" />
            </linearGradient>
            <radialGradient id="bg-glow" cx="50%" cy="60%" r="50%">
              <stop offset="0%" stopColor="#F5F3F0" />
              <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Background glow */}
          <ellipse cx="400" cy="240" rx="380" ry="200" fill="url(#bg-glow)" />

          {/* Back clouds (lower opacity, behind numerals) */}
          <ellipse cx="120" cy="280" rx="80" ry="30" fill="white" opacity="0.5" />
          <ellipse cx="680" cy="280" rx="80" ry="30" fill="white" opacity="0.5" />
          <ellipse cx="250" cy="240" rx="90" ry="35" fill="white" opacity="0.4" />
          <ellipse cx="550" cy="240" rx="90" ry="35" fill="white" opacity="0.4" />
          <ellipse cx="400" cy="260" rx="100" ry="40" fill="white" opacity="0.6" />
          <ellipse cx="330" cy="300" rx="70" ry="25" fill="white" opacity="0.45" />
          <ellipse cx="470" cy="300" rx="70" ry="25" fill="white" opacity="0.45" />

          {/* "4" left — sand */}
          <text
            fontSize="280"
            fontWeight="800"
            fill="url(#gradient-sand)"
            textAnchor="middle"
            x="195"
            y="300"
            fontFamily="system-ui, sans-serif"
            opacity="0.9"
          >
            4
          </text>
          {/* "0" center — charcoal/black */}
          <text
            fontSize="280"
            fontWeight="800"
            fill="#2C2C2C"
            textAnchor="middle"
            x="400"
            y="300"
            fontFamily="system-ui, sans-serif"
            opacity="0.85"
          >
            0
          </text>
          {/* "4" right — sand */}
          <text
            fontSize="280"
            fontWeight="800"
            fill="url(#gradient-sand)"
            textAnchor="middle"
            x="605"
            y="300"
            fontFamily="system-ui, sans-serif"
            opacity="0.9"
          >
            4
          </text>

          {/* Front clouds (higher opacity, overlapping bottom of numerals) */}
          <ellipse cx="150" cy="330" rx="110" ry="35" fill="white" opacity="0.8" />
          <ellipse cx="650" cy="330" rx="110" ry="35" fill="white" opacity="0.8" />
          <ellipse cx="300" cy="340" rx="100" ry="30" fill="white" opacity="0.85" />
          <ellipse cx="500" cy="340" rx="100" ry="30" fill="white" opacity="0.85" />
          <ellipse cx="400" cy="350" rx="120" ry="40" fill="white" opacity="0.9" />
          <ellipse cx="230" cy="360" rx="80" ry="28" fill="white" opacity="0.75" />
          <ellipse cx="570" cy="360" rx="80" ry="28" fill="white" opacity="0.75" />
        </svg>
      </div>
      <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-semibold text-ora-charcoal mb-3 sm:mb-4 max-w-xs sm:max-w-md lg:max-w-2xl leading-tight">
        {content[locale].headline}
      </h1>
      <p className="text-sm sm:text-base text-ora-slate mb-8 sm:mb-10 max-w-[280px] sm:max-w-sm md:max-w-md leading-relaxed">
        {content[locale].subtitle}
      </p>
      <Link
        href={content[locale].ctaHref}
        className="inline-flex h-11 items-center px-8 text-sm font-medium bg-ora-charcoal text-ora-white rounded-full hover:bg-ora-charcoal-dark transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2"
      >
        {content[locale].cta}
      </Link>
    </section>
  );
}
