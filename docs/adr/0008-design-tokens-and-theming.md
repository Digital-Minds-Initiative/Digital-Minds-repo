# 0008. Three-layer design tokens; semantic tokens are the Tailwind theme

- Status: Accepted
- Date: 2026-10-10

## Context

The design system must be re-themable without touching components: dark mode now, per-club branding later (`[data-brand="<club>"]`). The UI is Arabic and right-to-left first.

## Decision

- `src/styles/tokens.css` has three layers:
  1. **Primitives** (`--palette-*`, `--size-*`, `--typeface-*`): raw OKLCH colours, sizes, radii, type scale, font stack. They live outside Tailwind's namespaces, so no utility class can reach them.
  2. **Semantic tokens** (`--color-bg`, `--color-fg`, `--color-surface-1…3`, `--color-primary*`, `--color-danger*`, `--color-border`, `--radius-*`, `--shadow-*`, `--text-*`, `--font-sans`): declared in `@theme static`, so they _are_ the Tailwind theme (`bg-surface-1`, `text-fg-muted`, `rounded-lg`) and are always emitted as CSS variables. Tailwind's default palette and scales are removed (`--color-*: initial`…).
  3. **Components** use semantic utilities only.
- **Themes override semantic tokens** under a selector: `:root[data-theme='dark']` today, `[data-brand='<club-slug>']` later (the club `slug` is already in the database).
- The theme preference is a cookie (`light`/`dark`/`system`) read by the root layout, so the server renders the right `data-theme`; a few-line inline script resolves `system` before the first paint. No theme library.
- The font (IBM Plex Sans Arabic via `next/font`) is exposed through `--typeface-arabic-sans` → `--font-sans`; swapping it touches two lines.
- **RTL** is the default document direction; components use logical properties only. ESLint (`eslint-plugin-better-tailwindcss`) rejects physical-direction classes (`ml-`, `pr-`, `left-`, `text-right`…), raw colour values and unknown classes — so `bg-red-500` fails lint because it no longer exists.
- Primitives and patterns follow shadcn/ui conventions (Radix + `cva` + `cn`) but are our code.

## Consequences

- A theme or brand is a block of semantic overrides; no component changes.
- Developers must use semantic names; the token reference is in Storybook (Foundations → Tokens).
- Copying a component from shadcn/ui needs its colour classes mapped to our token names.
