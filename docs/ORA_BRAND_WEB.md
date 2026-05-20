# ORA Brand — Web Reference

Distilled from `docs/ORA_BrandGuidelines_v1_2022.pdf` (sections 6.1 Logotype, 6.2 Color palette, 6.3 Typography, 8.1 Website concept, 8.3 Favicon). This file is the **canonical brand reference for code**. If anything in `design-system.md` or `app/globals.css` disagrees with this file, this file wins.

---

## 1. Color Palette

### Primary

| Name      | Pantone        | RGB             | Hex       |
| --------- | -------------- | --------------- | --------- |
| **White** | Total White C  | 255, 255, 255   | `#FFFFFF` |
| **Silver**| Cool Gray 6 C  | 181, 181, 181   | `#B5B5B5` |
| **Sand**  | 468 C          | 227, 203, 168   | `#E3CBA8` |

Hierarchy rule from the guide: **White is dominant**, then Silver, with Sand reserved for accents/warmth. White is treated as a color, not just empty space.

### Secondary

| Name          | Pantone | RGB           | Hex       |
| ------------- | ------- | ------------- | --------- |
| **Dark Gray** | 446 C   | 38, 38, 38    | `#262626` |
| **Sun**       | 2434 C  | 234, 139, 110 | `#EA8B6E` |
| **Ocean**     | 629 C   | 165, 224, 230 | `#A4E0E6` |

Secondary palette is used as **couplers** for the primary palette (highlights, CTAs, illustrative key visuals). Dark Gray is the working text color.

### Don'ts (from guide)

- Don't introduce colors outside this palette for brand surfaces.
- Don't recolor or distort the logo.
- Don't mix multiple accent colors at once on a single surface.

### Auxiliary UI palette (not in brand guide — defined here for product UI)

The brand guide is a corporate identity document and does not specify status colors (success, warning, error, info), border tints, or hover states. The values below are an **engineering extension** chosen to harmonize with the brand palette and are scoped to the product UI only — never use them in marketing collateral.

| Purpose | Hex       |
| ------- | --------- |
| Success | `#5C8A6B` |
| Warning | `#C4A35A` |
| Error   | `#B85C5C` |
| Info    | `#5C7A8A` |

---

## 2. Typography

### Primary — URW Geometric

- **Family**: URW Geometric (URW++/Monotype, paid)
- **Weights used**: Light, Medium, Bold
- Used for headings, hero copy, and any large brand-forward typography.
- License must be acquired and the font self-hosted (`next/font/local`) before it can ship in production. Until then, fall back to Public Sans.

### Secondary — Public Sans

- **Family**: Public Sans (Google Fonts, free)
- Used for UI, body text, sub-headings, interface labels.
- Pairs with URW Geometric.

### Office / email fallback

- Arial (when neither URW Geometric nor Public Sans is available, e.g. Outlook).

### Web font tokens

| CSS variable             | Resolves to                                            | Use for                                  |
| ------------------------ | ------------------------------------------------------ | ---------------------------------------- |
| `--font-public-sans`     | Public Sans (loaded via `next/font/google`)            | UI / body / default `--font-sans`        |
| `--font-urw-geometric`   | URW Geometric if self-hosted, otherwise Public Sans    | Display / headings / hero (`font-display`) |
| `--font-sans`            | Public Sans                                             | App default                               |
| `--font-mono`            | Geist Mono (engineering decision; not in brand guide) | Code, slugs, IDs                         |

---

## 3. Logo

- Main version: **Silver logo on White** background (default whenever possible).
- Alternative: White logo on Silver/Sand/Dark Gray/photography backgrounds.
- Black & white version only when the main version cannot be reproduced.
- **Clear space**: defined by the `O` glyph; never invade with adjacent elements.
- **Minimum size**: 8 mm / **30 px** height.
- Tagline lockup: "Reimagining Time".
- Never recolor, distort, expand, compress, or stack with other brands inside the clear space.

---

## 4. Website (Section 8.1)

- Home page: parallax effect, full-screen video or image.
- Navigation pattern in guide: `HOME · DEVELOPMENTS · OUR TEAM · CONTACT`.
- Layouts combine photography, the corporate typeface, and the "key visual" (horizontal lines).
- Mobile responsive: stacked, hero-first, generous whitespace.
- Look & feel: editorial, monochrome-leaning, white-dominant, with sand and sun used sparingly as accents.

---

## 5. Favicon (Section 8.3)

- Use the `O` mark from the logotype.
- Render in **Silver on White** by default; provide a White-on-Dark Gray variant for dark-mode browsers.

---

## 6. Mapping to product code

The product UI ships with token names that pre-date this audit (`ora-cream`, `ora-gold`, `ora-stone`, `ora-charcoal`, etc.). Rather than rename ~400 call sites, the **token hex values are remapped** to the official brand colors, and **official-name aliases** are added.

### Brand → Token alias

| Brand color       | Canonical alias        | Legacy alias (kept for compatibility)             |
| ----------------- | ---------------------- | ------------------------------------------------- |
| White `#FFFFFF`   | `ora-white`            | —                                                 |
| Silver `#B5B5B5`  | `ora-silver`           | `ora-stone` family                                |
| Sand `#E3CBA8`    | `ora-sand` (re-hex'd)  | `ora-cream` family (warm off-whites derived from Sand) |
| Dark Gray `#262626` | `ora-dark-gray`      | `ora-charcoal` family                             |
| Sun `#EA8B6E`     | `ora-sun`              | `ora-gold` family (re-hex'd from old gold to Sun) |
| Ocean `#A4E0E6`   | `ora-ocean`            | —                                                 |

> **Behaviour change:** the old "gold" accent (`#B8956B`) is replaced by **Sun** (`#EA8B6E`). All CTAs, focus rings, progress bars, and active states will shift from warm gold to the brand's peach/coral. This is intentional and matches the brand guide.

> **Behaviour change:** the old "sand" (`#E8E4DF`, a near-grey neutral) is replaced by the **true brand Sand** (`#E3CBA8`, warm beige). Borders and dividers using `ora-sand` will warm up noticeably.

### New code — prefer the canonical aliases

When writing new components, use the canonical aliases (`ora-silver`, `ora-sun`, `ora-ocean`, `ora-dark-gray`, plus `ora-white` and `ora-sand`). The legacy aliases will be deprecated over time.
