# ClueXP — UI Guide (Design System)

> **This is the ClueXP UI Guide** — canonical doc for visual language, tokens, and shared
> UI across all four surfaces. The per-subsystem **screen/flow specs** (intake, technician,
> partner, ops) live in [`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) §"Subsystems"; this guide is
> the cross-cutting visual layer they all reference. Visual reference mocks live in
> [`design-ref/`](design-ref/) (assets only — see `design-ref/ui/README.md`).
>
> **Single source of truth for visual language and UI across all surfaces.** Extracted from the
> **live intake app** (`apps/intake-web/src/app/globals.css`), which is the canonical
> reference. Every other surface — technician app, `provider-web`, `ops-web` (and the
> shared `packages/console-ui`; `SYSTEM-DESIGN.md` §20.3) — inherits these tokens so the product reads
> as one system.
>
> **Mocks are visual exploration, not new requirements.** Where a mock and the relevant
> subsystem spec in `SYSTEM-DESIGN.md` disagree, the spec wins.
>
> **Two implementation stacks, one visual system.** Intake and technician surfaces use
> hand-written CSS custom properties. The ops/provider consoles intentionally use
> **Tailwind v4 + shadcn/ui primitives** themed to these same tokens. This is **not design
> drift** — it is the deliberate console implementation stack for dense enterprise
> operations UI (`SYSTEM-DESIGN.md` §20.3). §2.3 and §6 record how the brand tokens map into that stack.

---

## 1. Design language (one line)
Dark, industrial-minimal, high-contrast. Amber primary on near-black, narrow condensed
type, heavy weights, square-ish 4px corners, faint grid texture. Operational and honest —
**not** marketing, **not** decorative. Calm by default; strong color only for real alerts.

Console inspiration: Stripe / Linear / Vercel / Uber-ops **dark** dashboards — calm,
operational, trustworthy; color reserved for status, urgency, and action.

## 1.1 Brand assets

Official brand reference files live in `docs/design-ref/brand/`:

| File | Use |
|---|---|
| `logo.png` | Production app logo. Copy this exact filename to every app `public/logo.png`. Use for expanded app chrome and visible wordmark placement. |
| `icon.png` | Production app icon. Copy this exact filename to every app `public/icon.png`. Use for favicons, PWA icons, and collapsed console sidebar rails. |
| `cluexp-brand-board.png` | Visual reference board: logo, icon, tagline, and brand values. Use for design context, not app chrome. |
| `cluexp-logo-reversed.png` | White/reversed logo reference for dark product UI. |
| `cluexp-logo-on-light.png` | Black logo reference for light surfaces, documents, and white-background mocks. |

`logo.png` and `icon.png` are the production app assets. Keep those filenames stable because all
four apps reference them as root-relative public files (`/logo.png`, `/icon.png`). If a formal
designer-exported SVG becomes available, add it here first, update this guide, then migrate all
four app references in one commit.

### 1.2 Replacing the logo and icon across all systems

When the brand changes, update the canonical source files first:

1. Replace `docs/design-ref/brand/logo.png`.
2. Replace `docs/design-ref/brand/icon.png`.
3. Copy both files into each app's public directory:
   - `apps/intake-web/public/logo.png`
   - `apps/intake-web/public/icon.png`
   - `apps/technician-web/public/logo.png`
   - `apps/technician-web/public/icon.png`
   - `apps/provider-web/public/logo.png`
   - `apps/provider-web/public/icon.png`
   - `apps/ops-web/public/logo.png`
   - `apps/ops-web/public/icon.png`
4. Keep the visible image elements pointed at the public-root paths, not relative filesystem
   paths. Required HTML/JSX properties:
   - Expanded logo: `<img src="/logo.png" alt="ClueXP" className="... object-contain" />`
   - Collapsed console icon: `<img src="/icon.png" alt="ClueXP" className="... object-contain" />`
   - Do not omit `alt`. Use `alt="ClueXP"` for brand identity. If a purely decorative duplicate
     is ever added, use `alt="" aria-hidden="true"` instead.
   - Set stable dimensions with CSS classes (`height`, `width`/`max-width`, `object-contain`) so
     the header/sidebar does not shift while the image loads.
5. Update app metadata icons in every `src/app/layout.tsx`:
   - `icons.icon = "/icon.png"`
   - `icons.apple = "/icon.png"`
6. Update PWA metadata where present. Technician currently owns
   `apps/technician-web/public/manifest.webmanifest`; its icon entry must use:
   - `"src": "/icon.png"`
   - `"sizes": "246x246"` for the current normalized square icon, or the actual square
     dimensions if the icon source changes
   - `"type": "image/png"`
   - `"purpose": "any maskable"`
7. Keep auth proxies from intercepting static brand files. Provider, ops, and technician proxies
   must allow:
   - `pathname === "/logo.png"`
   - `pathname === "/icon.png"`
8. Build and smoke-test all four systems:
   - `npm.cmd run build --workspace @cluexp/intake-web`
   - `npm.cmd run build:tech`
   - `npm.cmd run build:provider`
   - `npm.cmd run build:ops`
   - After deploy, verify every production domain returns `200 image/png` for `/logo.png` and
     `/icon.png`.

Implementation locations:

| Surface | Visible logo/icon references | Public assets | Metadata/proxy |
|---|---|---|---|
| Intake | `apps/intake-web/src/app/page.tsx`, `apps/intake-web/src/app/globals.css` | `apps/intake-web/public/logo.png`, `apps/intake-web/public/icon.png` | `apps/intake-web/src/app/layout.tsx` |
| Technician | `apps/technician-web/src/components/mobile.tsx` | `apps/technician-web/public/logo.png`, `apps/technician-web/public/icon.png` | `apps/technician-web/src/app/layout.tsx`, `apps/technician-web/public/manifest.webmanifest`, `apps/technician-web/src/proxy.ts` |
| Provider | `packages/console-ui/src/components/index.tsx` | `apps/provider-web/public/logo.png`, `apps/provider-web/public/icon.png` | `apps/provider-web/src/app/layout.tsx`, `apps/provider-web/src/proxy.ts` |
| Ops | `packages/console-ui/src/components/index.tsx` | `apps/ops-web/public/logo.png`, `apps/ops-web/public/icon.png` | `apps/ops-web/src/app/layout.tsx`, `apps/ops-web/src/proxy.ts` |

## 2. Color tokens

### 2.1 Base tokens (from live intake `:root`)

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

### 2.2 Semantic status colors
For chips across the technician app + consoles — extends the base palette; keep consistent
everywhere:
- **Online / ready / accepted** → green (e.g. `#3fb950`)
- **Route / en-route / navigation** → `--secondary` blue
- **Alert / urgent / safety / offer-expiring** → `--primary` amber → `--danger` red for critical
- **Blocked / suspended / expired** → `--danger` / desaturated
- Status must use **text/icon + color**, never color alone (accessibility).

### 2.3 Console token mapping (shadcn / Tailwind v4)
The same brand tokens are expressed as shadcn CSS variables in
`packages/console-ui/src/globals.css`, so console components style themselves with token
classes and no per-component color overrides. Available Tailwind colors:

`background, foreground, card, popover, primary` (= amber), `secondary, muted, accent,
destructive, border, input, ring, success, warn, info, sidebar (+ -foreground / -accent /
-border)`.

Conventions: token classes only (e.g. `bg-card text-card-foreground border-border`,
`text-muted-foreground`, `bg-primary text-primary-foreground`); `cn()` (clsx +
tailwind-merge) for class merging; lucide icons; `<html class="dark …">` (dark-only, no
light-mode toggle). Faint amber grid is rendered via `body::before`.

## 3. Typography
- **Family:** intake/technician use `"Arial Narrow", "Archivo Narrow", Arial, sans-serif`
  (condensed; load **Archivo Narrow** as the web font for non-Apple consistency). Consoles
  load **Inter** as `font-sans` (`--font-inter`) for dense body/table text and **Archivo
  Narrow** as `font-condensed` (`--font-archivo`) for titles/wordmark.
- **Scale (from live intake):** agent message `32px/1.08`; support `18px/1.4`; big-number
  `30px`; wordmark `18px`; field text `18px`; body `~14–16px`; kicker/subtitle `12px`
  uppercase; fine `14px`.
- **Weights:** heavy is the signature — `800` headings/choices, `900` buttons/panel-titles/
  big-numbers, `500` secondary inline text. Avoid light weights.
- **Uppercase** for wordmark, kickers, panel titles, subtitles.
- **Consoles:** strong condensed titles, smaller muted secondary text, clear hierarchy — no
  oversized hero type. Use `tabular-nums` for metrics and numeric table columns.

## 4. Spacing, shape, texture
- **Radius (intake/technician):** `4px` everywhere (cards, buttons, fields, chips, OTP, map).
  Square-ish, not rounded. (Brand mark/avatars may be circular.)
- **Radius (consoles):** brand is square-ish, so use `rounded-md` / `rounded-lg` (≈6–8px).
  **Avoid** heavy `rounded-2xl`. Radius scale `sm / md / lg / xl` is defined in
  `console-ui/src/globals.css`.
- **Spacing rhythm (intake):** 6 / 10 / 12 / 16 / 22px; content column `min(100%, 600px)`
  centered; main padding `20px 16px 96px`.
- **Spacing rhythm (consoles):** 24–32px page padding, clean grid, aligned cards.
- **Borders:** 1px, low-opacity white (`rgba(255,255,255,0.12)`) on surfaces; amber on
  active; warm `--line` for emphasis. Soft shadows only where they add real depth.
- **Grid texture:** faint amber grid on `--bg` (`44px` tile) — the signature backdrop.
  Subtle only; never decorative motion.
- **Touch targets:** ≥ 58px primary buttons/choices, ≥ 54px fields, ≥ 44px minimum
  (accessibility floor).

## 5. Core components — intake (shared vocabulary)
These exist in the live intake app and are the seed for `packages/console-ui` + the
technician app:
- **Top bar** — sticky, production `logo.png` image + uppercase subtitle.
- **Step pipes** — 6-segment progress (intake only; **not** on fulfillment/console).
- **Agent message** — large `32px/800` framing line + `18px` muted support.
- **Choice / Chip** — full-width `58px`, left-aligned, heavy; `.active` = amber border +
  `#2a240d` fill; single-select auto-advances.
- **Field / textarea** — `54px`, `4px`, surface bg, `18px`.
- **Buttons** — `primary` (amber/dark text, `900`), `secondary` (blue), `ghost` (outline);
  full-width `58px`.
- **Panel** — bordered surface card; `panel-title` = uppercase soft-amber `900`.
- **Map** — bordered container, blue/amber line texture, amber location dot with glow.
  (Placeholder until real Google Maps; must read as a map, never fake movement — honest-status rule, §9.)
- **OTP boxes**, **demo banner** (amber-tinted), **error** (`--danger`).
- **Focus ring** — `2px solid --primary`, `3px` offset, on every interactive element.

### 5.1 Intake React component patterns

Build these as reusable components, not page-by-page markup (the intake flow behavior is
[`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) §18.1):

- **`<ChipSelect>`** — single/multi-select chips; single-select **auto-advances** on tap (no
  chevrons, no Continue button).
- **`<AgentMessage>`** — the calm large-type framing block atop intake screens.
- **`<StepPipes>`** — intake progress indicator, fixed total across all intake screens; **never**
  shown on fulfillment.
- **`<CallAPersonButton>`** — the always-present human-fallback; identical label/position/size on
  every screen, framed as an upgrade not an error.
- **`<TrustStateGate>`** — wrapper that hides technician/ETA/tracking children unless the Ticket's
  trust-state permits. **The backend guard methods (`may_show_technician()` / `may_show_eta()` /
  `may_show_live_tracking()`) are the authority — the UI never decides for itself.**
- **`<EstimateRangeAccept>`** — explicit price acceptance (no auto-advance, no pre-check).
- **`<EstimateVsFinal>`** — estimate-vs-final comparison; calm when final ≤ max, explicit-approval
  flow when final > max.

### 5.2 Mocks & generated UI (Stitch) — reference only

Visual mocks in [`design-ref/`](design-ref/) are a sketch, not the codebase. **Lift** tokens,
typography, spacing, and the "large agent message → controls → footer" rhythm. **Do not** import
generated HTML, carry forward its bugs, or treat its micro-interactions as authoritative — rebuild
as React with the animation discipline (§9). Where a mock and a subsystem spec disagree, the spec wins.

## 6. Console component library (`packages/console-ui`)
The ops/provider consoles are built on shadcn/ui + Tailwind v4 themed to the tokens above.
This is the live component catalog; build all console screens from these (never hand-rolled
Tailwind).

### 6.1 Primitives — `console-ui/src/ui/`
Standard shadcn/ui v4 primitives themed by our vars: `button` (variants
default/secondary/outline/ghost/destructive; sizes default/sm/lg/icon — the reference style
for every primitive), `badge`, `card` (Card/Header/Title/Description/Content/Footer),
`input`, `separator`, `skeleton`, `avatar`, `dropdown-menu`, `sheet` (Radix Dialog →
right-side drawer), `tooltip`, `table` (Table/Header/Body/Row/Head/Cell), `tabs`,
`scroll-area`.

### 6.2 Composed components — `console-ui/src/components/`
- **`AppShell`** — fixed Sidebar + sticky Topbar + scrollable content (`max-w` container,
  24–32px padding). Props: `{ mode, surfaceLabel, modeBadge, nav, activePath, children }`.
- **`Sidebar`** — collapsible (icon-rail ↔ expanded, state persists). Logo area uses
  `/logo.png` when expanded and `/icon.png` when collapsed. **Grouped nav** with section labels:
  - **Operations:** Dashboard, Live Queue, Dispatch Board, Map, Escalations, Messages
  - **Network:** Technicians, Teams, Documents
  - **Finance:** Reports (revenue/settlement)
  - **Admin:** Settings, Audit Log
  - Active item: amber left-accent + `bg-sidebar-accent`; tooltips when collapsed. Nav is
    driven by the `nav` prop per app — the **provider surface hides ClueXP-only items**
    (no platform-Escalations ownership beyond escalate-to-ClueXP; no dispatch-policy).
- **`Topbar`** — global search (Cmd/Ctrl-K affordance), **environment badge** ("Production"
  pill), **operational status** ("All systems operational" dot), **notifications** (bell +
  count dropdown), **profile menu** (avatar → account / switch workspace / sign out). Keeps
  the mode badge.
- **`PageHeader`** — `{ kicker?, title, description?, actions? }`. Strong condensed title,
  muted description.
- **`StatCard`** — `{ label, value, delta?, trend?, icon?, intent? }` operational metric
  card (subtle border, hover, tabular-nums).
- **`StatusBadge`** — maps domain `ConsoleStatus` + trust + verification → Badge
  variant/label/dot (see §7).
- **`RequestTable`** — shadcn Table: sticky header, search/filter bar, column alignment
  (numeric right, tabular-nums), row hover, **row-action DropdownMenu** (Open, Assign,
  Route, Escalate, Call…), status badges, pagination footer, empty state.
- **`DispatchQueue`** — dense queue list with priority indicators; row → opens
  `RequestDrawer`.
- **`RequestDrawer`** — `Sheet` (right drawer): status + trust chip, access/situation,
  safety flags, assigned tech, SLA countdown, timeline, actions.
- **`TechnicianCard`** — avatar, name, skills, ETA/distance, eligibility badge,
  direct-release chip, trust/safety mini-indicators, actions (Assign / Send Offer / Hold /
  View Profile / Override).
- **`Timeline`** — vertical event list (actor, time, event, trust snapshot, metadata).
- **`SlaCountdown`** — `{ deadline | targetMinutes }` from a backend timestamp; shows mm:ss,
  warn → danger as it nears 0; "SLA Risk" state.
- **`MapCard`** — bordered static map (job/tech markers + legend + service area +
  staleness). No fake movement.
- **`EmptyState`** — `{ icon, title, description, action? }`.
- **`TrustSafety`** — panel/badges: Verified professional, Background check, License status,
  Insurance status, Payment risk, Customer no-show history.

### 6.3 Screens — `console-ui/src/screens/`
The consoles render a **Dashboard** home (`/` → `/dashboard`) plus the operational screens:
Live Queue, Dispatch Board, Job Detail, Technician Assignment, Route to Organization, Org
Job Intake, Map, Escalations, Documents, Audit Log. The Dashboard is a grid of `StatCard`s —
**Live Requests, Average ETA, Active Professionals, SLA Risk, Revenue Today, Completion
Rate** — plus a live-queue preview, an escalations/at-risk strip, and a recent-activity
timeline. Use realistic emergency-access (locksmith) data only — no ecommerce/crypto
widgets, no lorem. Lists show `Skeleton` while loading and `EmptyState` when empty.

## 7. Status badge system
`console_status` is the **source of truth**; badges are presentation only. `Badge` variants:
`neutral, info, success, warn, danger, critical, outline`. `StatusBadge` maps domain state →
variant + label + dot/icon:

| Presentation label | Source `console_status` |
|---|---|
| New | awaiting assignment |
| Assigned | offer sent / accepted |
| En Route | en route |
| On Site | arrived |
| In Service | in service |
| Completed | completed |
| Cancelled / Escalated | escalated |
| SLA Risk | derived from `SlaCountdown` nearing deadline |
| Verification Pending / Verified | derived from trust/verification state |

## 8. Surface-specific adjustments (same tokens, different density)
- **Intake (customer):** generous spacing, one big decision per screen, calm. ✅ live baseline.
- **Technician (mobile):** same dark/amber, but **field-readable** — larger hit areas,
  bottom-nav, full-screen offer alert is the one place strong alarm color is allowed.
- **Consoles (provider/ops):** **denser** — compact rows, tables, multi-panel; same palette
  but dialed for scanning, not one-decision-at-a-time. "No decorative dashboards" (console
  spec §12). Enterprise-polish targets: clean 24/32px grid; collapsible grouped sidebar with
  a clear active state; header with global search + env badge + notifications + profile +
  operational status; dispatch-first layout (live queue, request side-drawer, priority
  indicators, technician assignment card, timeline, SLA countdown); subtle borders and
  skeletons/empty states throughout. Responsive; dark-only.

## 9. Hard UI contracts (must survive any restyle)
These are behavior/UI invariants from the subsystem specs in
[`SYSTEM-DESIGN.md`](SYSTEM-DESIGN.md) §18 (which remain authoritative); surfaced here because
they constrain the visual layer:
- Dispatch Board lanes = **`console_status`** (Awaiting assignment, Offer sent, Accepted, En
  route, Arrived, In service, Approval needed, Completed, Escalated). Trust-state is only a
  per-card chip.
- `TrustStateChip` renders only **INTAKE | MATCHED | FULFILLMENT**.
- Technician assignment stays **locksmith/access domain**, with offer actions, `expires_at`
  countdown, **backend-enforced first-accept-wins** note, override-with-reason, and
  **cluexp-only** direct-release chip.
- Map: factual copy, job vs tech markers + legend + service area + staleness. No fake movement.
- Docs approve/reject/suspend = **cluexp mode only**.
- No screen implies org acceptance = customer `MATCHED`.
- Mode badges stay distinct (ops = "CLUEXP MODE" / ops surface; provider = "ORGANIZATION
  MODE: METRO KEY PARTNERS").

---

## How to use this with mocking tools
- **Figma:** create color styles + text styles from §2–§3; build §5–§6 as components/variants.
- **v0 / code:** feed §2 as CSS vars or a Tailwind theme; §5 already exist as classes in
  `globals.css`, and §6 components live in `packages/console-ui` to reuse directly.
- **Stitch / AI:** paste §1–§4 into the design prompt (see each spec's §17) so generated
  screens inherit the language.
