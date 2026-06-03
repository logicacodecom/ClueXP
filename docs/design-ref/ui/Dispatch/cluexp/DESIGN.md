---
name: ClueXP
colors:
  surface: '#1c1b1b'
  surface-dim: '#181309'
  surface-bright: '#3f382d'
  surface-container-lowest: '#120e05'
  surface-container-low: '#201b11'
  surface-container: '#241f14'
  surface-container-high: '#2f291e'
  surface-container-highest: '#3a3428'
  on-surface: '#ede1d0'
  on-surface-variant: '#d4c5ab'
  inverse-surface: '#ede1d0'
  inverse-on-surface: '#363024'
  outline: '#9c8f78'
  outline-variant: '#504532'
  surface-tint: '#fbbc00'
  primary: '#ffe2ab'
  on-primary: '#402d00'
  primary-container: '#ffbf00'
  on-primary-container: '#6d5000'
  inverse-primary: '#795900'
  secondary: '#b4c5ff'
  on-secondary: '#002a78'
  secondary-container: '#0053db'
  on-secondary-container: '#cdd7ff'
  tertiary: '#b4efff'
  on-tertiary: '#003640'
  tertiary-container: '#04dcff'
  on-tertiary-container: '#005d6d'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdfa0'
  primary-fixed-dim: '#fbbc00'
  on-primary-fixed: '#261a00'
  on-primary-fixed-variant: '#5c4300'
  secondary-fixed: '#dbe1ff'
  secondary-fixed-dim: '#b4c5ff'
  on-secondary-fixed: '#00174b'
  on-secondary-fixed-variant: '#003ea8'
  tertiary-fixed: '#aaedff'
  tertiary-fixed-dim: '#00d9fc'
  on-tertiary-fixed: '#001f26'
  on-tertiary-fixed-variant: '#004e5c'
  background: '#181309'
  on-background: '#ede1d0'
  surface-variant: '#3a3428'
  bg: '#0e0e0e'
  surface-high: '#2a2a2a'
  text: '#e5e2e1'
  muted: '#d4c5ab'
  line: '#504532'
  primary-soft: '#ffe2ab'
  primary-text: '#261a00'
  secondary-soft: '#b4c5ff'
  danger: '#ffb4ab'
  active-fill: '#2a240d'
  success: '#3fb950'
typography:
  agent-message:
    fontFamily: Archivo Narrow
    fontSize: 32px
    fontWeight: '800'
    lineHeight: '1.08'
  headline-lg:
    fontFamily: Archivo Narrow
    fontSize: 30px
    fontWeight: '900'
    lineHeight: 36px
  button-text:
    fontFamily: Archivo Narrow
    fontSize: 18px
    fontWeight: '900'
    lineHeight: 24px
  field-text:
    fontFamily: Archivo Narrow
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 24px
  body:
    fontFamily: Archivo Narrow
    fontSize: 16px
    fontWeight: '500'
    lineHeight: '1.4'
  kicker:
    fontFamily: Archivo Narrow
    fontSize: 12px
    fontWeight: '900'
    lineHeight: 16px
    letterSpacing: 0.05em
  fine-print:
    fontFamily: Archivo Narrow
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base-6: 6px
  base-10: 10px
  base-12: 12px
  base-16: 16px
  base-22: 22px
  target-primary: 58px
  target-field: 54px
  target-min: 44px
---

# ClueXP — Design System

> **Source of truth for visual language across all surfaces.** Extracted from the
> **live intake app** (`apps/intake-web/src/app/globals.css`), which is the canonical
> reference. Every other surface — technician app, `provider-web`, `ops-web` (and the
> shared `packages/console-ui`; `adr/0003`) — inherits these tokens so the product reads
> as one system.
>
> **Mocks are visual exploration, not new requirements.** Where a mock and the relevant
> spec (SPEC.md, TECHNICIAN-MOBILE-SPEC, ORGANIZATION-DISPATCH-CONSOLE-SPEC) disagree, the
> spec wins (mirrors SPEC §8).
>
> **Note (stack reality):** the live app is **hand-written CSS custom properties**, not
> Tailwind (SPEC §5.1 says Tailwind — that's aspirational/stale). Tokens below are
> framework-neutral so they map cleanly to CSS vars, a Tailwind config, or Figma styles.

---

## 1. Design language (one line)
Dark, industrial-minimal, high-contrast. Amber primary on near-black, narrow condensed
type, heavy weights, square-ish 4px corners, faint grid texture. Operational and honest —
**not** marketing, **not** decorative. Calm by default; strong color only for real alerts.

## 1.1 Brand assets

Official brand reference files live in `docs/design-ref/brand/`:

| File | Use |
|---|---|
| `cluexp-brand-board.png` | Visual reference board: logo, icon, tagline, and brand values. Use for design context, not app chrome. |
| `cluexp-logo-reversed.png` | White/reversed logo reference for dark product UI. |
| `cluexp-logo-on-light.png` | Black logo reference for light surfaces, documents, and white-background mocks. |

These PNG files are the current brand references. If a formal designer-exported SVG becomes
available, add it here and treat that SVG as the production app asset.

## 2. Color tokens (from live `:root`)

| Token | Hex | Role |
|---|---|---|
| `--bg` | `#0e0e0e` | app background (near-black) |
| `--surface` | `#1c1b1b` | cards, fields, panels |
| `--surface-high` | `#2a2a2a` | raised surface |
| `--text` | `#e5e2e1` | primary text |
| `--muted` | `#d4c5ab` | secondary/support text (warm grey) |
| `--line` | `#504532` | borders/dividers (warm) |
| `--primary` | `#ffbf00` | **amber** — primary action, active, brand mark |
| `--primary-soft` | `#ffe2ab` | kickers, panel titles, soft amber text |
| `--primary-text` | `#261a00` | text **on** amber (dark) |
| `--secondary` | `#2563eb` | blue — secondary action / navigation/route |
| `--secondary-soft` | `#b4c5ff` | soft blue (map lines, accents) |
| `--danger` | `#ffb4ab` | errors / destructive |
| active-fill | `#2a240d` | selected choice/chip background (amber-tinted) |

**Semantic status colors** (for chips across technician app + consoles — extends the base
palette; keep consistent everywhere):
- **Online / ready / accepted** → green (e.g. `#3fb950`)
- **Route / en-route / navigation** → `--secondary` blue
- **Alert / urgent / safety / offer-expiring** → `--primary` amber → `--danger` red for critical
- **Blocked / suspended / expired** → `--danger` / desaturated
- Status must use **text/icon + color**, never color alone (accessibility).

## 3. Typography
- **Family:** `"Arial Narrow", "Archivo Narrow", Arial, sans-serif` (condensed; load
  **Archivo Narrow** as the web font for non-Apple consistency).
- **Scale (from live):** agent message `32px/1.08`; support `18px/1.4`; big-number `30px`;
  wordmark `18px`; field text `18px`; body `~14–16px`; kicker/subtitle `12px` uppercase;
  fine `14px`.
- **Weights:** heavy is the signature — `800` headings/choices, `900` buttons/panel-titles/
  big-numbers, `500` secondary inline text. Avoid light weights.
- **Uppercase** for wordmark, kickers, panel titles, subtitles.

## 4. Spacing, shape, texture
- **Radius:** `4px` everywhere (cards, buttons, fields, chips, OTP, map). Square-ish, not
  rounded. (Brand mark/avatars may be circular.)
- **Spacing rhythm:** 6 / 10 / 12 / 16 / 22px; content column `min(100%, 600px)` centered;
  main padding `20px 16px 96px`.
- **Borders:** 1px, low-opacity white (`rgba(255,255,255,0.12)`) on surfaces; amber on
  active; warm `--line` for emphasis.
- **Grid texture:** faint amber grid on `--bg` (`44px` tile) — the signature backdrop.
  Subtle only; never decorative motion.
- **Touch targets:** ≥ 58px primary buttons/choices, ≥ 54px fields, ≥ 44px minimum
  (accessibility floor).

## 5. Core components (live intake → shared vocabulary)
These exist in intake and are the seed for `packages/console-ui` + the technician app:
- **Top bar** — sticky, brand mark (amber) + wordmark + uppercase subtitle.
- **Step pipes** — 6-segment progress (intake only; **not** on fulfillment/console).
- **Agent message** — large `32px/800` framing line + `18px` muted support.
- **Choice / Chip** — full-width `58px`, left-aligned, heavy; `.active` = amber border +
  `#2a240d` fill; single-select auto-advances.
- **Field / textarea** — `54px`, `4px`, surface bg, `18px`.
- **Buttons** — `primary` (amber/dark text, `900`), `secondary` (blue), `ghost` (outline);
  full-width `58px`.
- **Panel** — bordered surface card; `panel-title` = uppercase soft-amber `900`.
- **Map** — bordered container, blue/amber line texture, amber location dot with glow.
  (Placeholder until real Google Maps; must read as a map, never fake movement — SPEC §5.4.)
- **OTP boxes**, **demo banner** (amber-tinted), **error** (`--danger`).
- **Focus ring** — `2px solid --primary`, `3px` offset, on every interactive element.

## 6. New components needed by later surfaces (design to this system)
Not in intake yet — build in `console-ui` / technician app using the tokens above:
- **Status chip** (the semantic colors in §2), **job card / queue row** (compact, dense),
  **data table / queue**, **detail split-panel**, **technician picker row**, **timeline /
  audit list**, **incoming-offer full-screen alert** (technician; strong amber/red +
  countdown), **persistent active-job bar**, **left-nav** (consoles).

## 7. Surface-specific adjustments (same tokens, different density)
- **Intake (customer):** generous spacing, one big decision per screen, calm. ✅ live baseline.
- **Technician (mobile):** same dark/amber, but **field-readable** — larger hit areas,
  bottom-nav, full-screen offer alert is the one place strong alarm color is allowed.
- **Consoles (provider/ops):** **denser** — compact rows, tables, multi-panel; same palette
  but dialed for scanning, not one-decision-at-a-time. "No decorative dashboards" (console
  spec §12).