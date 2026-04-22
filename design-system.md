# ORA Design System

A luxury warm-neutral design system for enterprise applications. Thin strokes, minimal shadows, clean typography, and a gold accent palette.

---

## Tech Stack

- Next.js (App Router)
- Tailwind CSS v4 (with `@theme inline` custom tokens)
- Geist Sans / Geist Mono fonts (via `next/font/google`)
- Lucide React icons (always `stroke-1`)
- Framer Motion (animations/transitions)

---

## Color Palette

All colors use the `ora-` prefix as Tailwind tokens (e.g. `bg-ora-cream`, `text-ora-charcoal`).

### Neutrals (Backgrounds & Surfaces)

| Token | Hex | Usage |
|-------|-----|-------|
| `ora-white` | `#FFFFFF` | Page background, card background |
| `ora-cream-light` | `#F9F7F5` | Subtle hover states, alternate rows |
| `ora-cream` | `#F5F3F0` | Secondary backgrounds, button secondary bg |
| `ora-cream-dark` | `#EBE7E2` | Hover on cream surfaces |
| `ora-sand-light` | `#EDEAE6` | Light borders, dividers |
| `ora-sand` | `#E8E4DF` | Primary borders, card borders, input borders |
| `ora-sand-dark` | `#D4CFC8` | Stronger borders |
| `ora-stone-light` | `#DDD9D3` | Subtle UI elements |
| `ora-stone` | `#D4CFC8` | Input borders, secondary borders |
| `ora-stone-dark` | `#B8B3AB` | Muted UI, disabled borders |

### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `ora-charcoal-dark` | `#1A1A1A` | Headings, high emphasis |
| `ora-charcoal` | `#2C2C2C` | Primary body text, default text color |
| `ora-charcoal-light` | `#4A4A4A` | Secondary text, descriptions |
| `ora-graphite` | `#4A4A4A` | Button hover states |
| `ora-slate` | `#6B6B6B` | Tertiary text, labels |
| `ora-muted` | `#9A9A9A` | Placeholder text, disabled text, timestamps |

### Accent (Gold)

| Token | Hex | Usage |
|-------|-----|-------|
| `ora-gold-light` | `#D4B896` | Progress bars, light accents, hover gold |
| `ora-gold` | `#B8956B` | Primary accent, CTA buttons, active states, focus rings |
| `ora-gold-dark` | `#8B7355` | Gold button hover, dark accent |

### Status Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `ora-success` | `#5C8A6B` | Success states, completed, approved |
| `ora-warning` | `#C4A35A` | Warning states, pending, in-progress |
| `ora-error` | `#B85C5C` | Error states, rejected, failed |
| `ora-info` | `#5C7A8A` | Info states, started, informational |

Status badges use `bg-{status}/10 text-{status}` pattern (e.g. `bg-ora-success/10 text-ora-success`).

---

## Typography

### Fonts

- **Primary**: Geist Sans (`--font-geist-sans`) — clean geometric sans-serif
- **Monospace**: Geist Mono (`--font-geist-mono`) — for code, slugs, IDs

### Scale

| Class | Size | Usage |
|-------|------|-------|
| `text-2xl font-semibold` | 24px | Page titles |
| `text-xl font-semibold` | 20px | Section titles |
| `text-lg font-semibold` | 18px | Card titles |
| `text-base` | 16px | Body text |
| `text-sm` | 14px | Secondary text, descriptions, button text |
| `text-xs` | 12px | Labels, metadata, timestamps |
| `text-[10px]` | 10px | Micro labels, tracking-widest uppercase |

### Patterns

- Page titles: `text-2xl font-semibold text-ora-charcoal`
- Descriptions: `text-sm text-ora-charcoal-light`
- Labels: `text-xs font-medium text-ora-charcoal-light`
- Muted metadata: `text-xs text-ora-muted`
- Uppercase micro labels: `text-[10px] tracking-widest uppercase font-bold text-ora-muted`

---

## Borders & Shadows

### Borders

- **Primary border**: `border-ora-sand` or `border-ora-sand/60` — thin, subtle
- **Input border**: `border-ora-stone` — slightly stronger for form elements
- **Outline button border**: `border-ora-charcoal` — high contrast
- **Dividers**: `border-ora-sand` or `border-ora-cream-dark`
- **No border-radius by default** — square corners everywhere (buttons, cards, inputs)
- **Pill variant**: `rounded-full` — only when explicitly using pill size

### Shadows

Shadows are minimal. Prefer borders over shadows.

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-ora-sm` | `0 1px 2px rgba(44,44,44,0.04)` | Subtle elevation |
| `shadow-ora-md` | `0 4px 6px rgba(44,44,44,0.06)` | Cards on hover |
| `shadow-ora-lg` | `0 10px 15px rgba(44,44,44,0.08)` | Modals, sheets |

---

## Buttons

**Default shape is square** (no border-radius). Use `pill` sizes for rounded buttons.

### Variants

| Variant | Style | Usage |
|---------|-------|-------|
| `default` | `bg-ora-charcoal text-ora-white` | Primary actions |
| `gold` | `bg-ora-gold text-ora-white` | CTA, accent actions |
| `secondary` | `bg-ora-cream text-ora-charcoal border-ora-sand` | Secondary actions |
| `outline` | `bg-ora-cream/50 text-ora-charcoal border-ora-sand` | Tertiary actions |
| `ghost` | `bg-transparent text-ora-charcoal` | Icon buttons, subtle actions |
| `danger` | `bg-ora-error text-ora-white` | Destructive actions |
| `link` | `bg-transparent text-ora-gold underline` | Inline links |

### Sizes

| Size | Dimensions | Usage |
|------|-----------|-------|
| `default` | `h-10 px-6 text-sm` | Standard buttons |
| `sm` | `h-9 px-5 text-sm` | Compact buttons |
| `lg` | `h-12 px-8 text-base` | Large CTA |
| `icon` | `h-10 w-10` | Icon-only buttons |
| `pill` | `h-10 px-6 rounded-full` | Rounded standard |
| `pill-sm` | `h-9 px-5 rounded-full` | Rounded compact |
| `pill-lg` | `h-12 px-8 rounded-full` | Rounded large |

### Focus State

All interactive elements: `focus-visible:ring-2 focus-visible:ring-ora-gold focus-visible:ring-offset-2`

---

## Cards

- Background: `bg-ora-white`
- Border: `border border-ora-sand/60`
- Padding: `p-6`
- **No border-radius** (square)
- **No shadow** by default
- Title: `text-lg font-semibold text-ora-charcoal`
- Content text: `text-ora-charcoal-light`

```html
<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>Content here</CardContent>
  <CardFooter>Actions here</CardFooter>
</Card>
```

---

## Inputs

- Height: `h-10`
- Border: `border border-ora-stone`
- Background: `bg-ora-white`
- Text: `text-sm text-ora-charcoal`
- Placeholder: `placeholder:text-ora-muted`
- Focus: `focus-visible:ring-1 focus-visible:ring-ora-gold`
- **No border-radius** (square)

---

## Icons

Use **Lucide React** icons exclusively. Always apply thin strokes:

```tsx
<Icon className="h-5 w-5 stroke-1" />
```

The Button component auto-applies `[&_svg]:stroke-1` to nested SVGs.

Common sizes:
- `h-3 w-3 stroke-1` — inline with small text
- `h-3.5 w-3.5 stroke-1` — inline with buttons
- `h-4 w-4 stroke-1` — standard inline
- `h-5 w-5 stroke-1` — section headers
- `h-6 w-6 stroke-1` — page headers
- `h-10 w-10 stroke-1` — empty states
- `h-12 w-12 stroke-1` — large empty states

---

## Sheets (Side Panels)

- Slides in from right
- Default width: `60%`
- Background: `bg-ora-white`
- Border: `border-l border-ora-sand`
- Backdrop: `bg-ora-charcoal/30 backdrop-blur-sm`
- Header: `border-b border-ora-sand px-6 py-4`
- Close button: `h-8 w-8` with X icon

---

## Status Badges

Pattern: `inline-block rounded-full px-3 py-0.5 text-xs font-medium`

| Status | Classes |
|--------|---------|
| Draft | `bg-ora-sand text-ora-charcoal-light` |
| Published | `bg-ora-success/10 text-ora-success` |
| Unpublished | `bg-ora-warning/10 text-ora-warning` |
| Active | `bg-ora-gold/10 text-ora-gold-dark` |
| Error/Failed | `bg-ora-error/10 text-ora-error` |
| Info/Started | `bg-ora-info/10 text-ora-info` |
| Trashed | `bg-ora-error/10 text-ora-error` |

---

## Toggle Switches

```tsx
<button
  role="switch"
  aria-checked={checked}
  className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
    ${checked ? 'bg-ora-gold' : 'bg-ora-sand'}`}
>
  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-ora-white transition-transform
    ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`}
  />
</button>
```

---

## Loading Skeletons

```tsx
<Skeleton className="h-5 w-3/4" />
```

- Background: `bg-ora-sand/60`
- Animation: `animate-pulse`
- Rounded: `rounded`

---

## Modals / Dialogs

- Backdrop: `fixed inset-0 bg-ora-charcoal/40`
- Container: `Card` component centered with `max-w-xl mx-4`
- Close button in header: ghost variant, X icon

---

## Layout Patterns

### Page Header
```tsx
<div className="mb-6 flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-semibold text-ora-charcoal">Page Title</h1>
    <p className="mt-1 text-sm text-ora-charcoal-light">Description</p>
  </div>
  <Button><Plus className="mr-2 h-4 w-4 stroke-1" /> Action</Button>
</div>
```

### Tab Bar
```tsx
<div className="flex gap-1 border border-ora-sand bg-ora-white p-1 w-fit">
  <button className={active
    ? 'bg-ora-charcoal text-ora-white'
    : 'text-ora-charcoal-light hover:bg-ora-cream-light'
  }>Tab</button>
</div>
```

### Filter Chips
```tsx
<button className={active
  ? 'bg-ora-charcoal text-white'
  : 'bg-ora-sand/50 text-ora-charcoal-light hover:bg-ora-sand'
}>Filter</button>
```

### Grid Layouts
- Cards: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`
- Stats: `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`
- Two-column: `grid gap-6 lg:grid-cols-2`

---

## Key Design Principles

1. **Square by default** — no border-radius on buttons, cards, inputs. Only pills are rounded.
2. **Thin strokes** — all icons use `stroke-1`. Borders are thin (`1px`). No heavy shadows.
3. **Warm neutrals** — cream/sand/stone palette, not cold grays.
4. **Gold accent** — `ora-gold` for focus rings, CTAs, active states, progress bars.
5. **Minimal shadows** — prefer borders over box-shadows. Shadows only for elevated overlays.
6. **Luxury feel** — generous whitespace, clean typography, restrained color usage.
7. **Status colors are muted** — use `bg-{color}/10 text-{color}` pattern, never full saturation backgrounds.
