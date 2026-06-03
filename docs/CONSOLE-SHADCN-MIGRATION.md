# Console UI — shadcn/Tailwind migration (for Codex to execute)

> **Author:** Claude · **Date:** 2026-06-03 · **Executor:** Codex
> **Goal:** Rebuild the two dispatch consoles (`ops-web`, `provider-web`) on **shadcn/ui +
> Tailwind v4** while keeping the **ClueXP dark + amber** identity, raising them to
> enterprise-SaaS / "investor-ready admin portal" quality.
> **Phase 1 (foundation) is DONE by Claude** — see §2. Build Phases 2–4.

## 0. Decisions (locked with the human)
- **Keep dark + amber** (ClueXP brand) — do **NOT** switch to a light/white theme. Dark-only; no light-mode toggle required.
- **Adopt shadcn/ui + Tailwind v4** for the consoles (the consoles intentionally diverge in stack from intake/technician, which stay hand-written CSS — record this, don't treat as drift; see §6).
- Inspiration: Stripe/Linear/Vercel/Uber-ops **dark** dashboards. Calm, operational, trustworthy. Color only for status/urgency/action.
- Corners: brand is square-ish — use `rounded-md`/`rounded-lg` (≈6–8px). **Avoid** heavy `rounded-2xl`.
- **Do not rewrite from scratch** — refactor existing screens (`packages/console-ui/src/screens/index.tsx`) onto the new components. Keep `@cluexp/api-client` types/mock data (extend if needed, §5).

## 0.1 Hard contracts that must survive the restyle (unchanged from the console spec)
- Dispatch Board lanes = **`console_status`** (Awaiting assignment, Offer sent, Accepted, En route, Arrived, In service, Approval needed, Completed, Escalated). Trust-state is only a per-card chip.
- `TrustStateChip` renders only **INTAKE | MATCHED | FULFILLMENT**.
- Technician assignment stays **locksmith/access domain**, with offer actions, `expires_at` countdown, **backend-enforced first-accept-wins** note, override-with-reason, and **cluexp-only** direct-release chip.
- Map: factual copy, job vs tech markers + legend + service area + staleness. No fake movement.
- Docs approve/reject/suspend = **cluexp mode only**.
- No screen implies org acceptance = customer `MATCHED`.
- Mode badges stay distinct (ops = "CLUEXP MODE" / ops surface; provider = "ORGANIZATION MODE: METRO KEY PARTNERS").

## 1. Source of truth & precedence
1. `docs/ORGANIZATION-DISPATCH-CONSOLE-SPEC.md` — flows/states/screens.
2. This file — the migration build order + component contracts.
3. The enterprise-polish prompt (captured in §4 checklist below).
4. `docs/DESIGN-SYSTEM.md` — brand tokens (now expressed as shadcn vars in `console-ui/src/globals.css`).

## 2. Phase 1 — DONE (do not redo; build on it)
Committed `12b971f`:
- Tailwind v4 + `@tailwindcss/postcss` in both apps (`postcss.config.mjs`, `src/app/globals.css` with `@source`). Layouts load Inter + Archivo Narrow as `--font-inter` / `--font-archivo` and set `<html class="dark …">`.
- **`packages/console-ui/src/globals.css`** — ClueXP dark/amber as shadcn tokens. Available Tailwind colors: `background, foreground, card, popover, primary` (=amber), `secondary, muted, accent, destructive, border, input, ring, success, warn, info, sidebar(+ -foreground/-accent/-border)`. Radius scale `sm/md/lg/xl`. Fonts: `font-sans` (Inter), `font-condensed` (Archivo). Faint grid via `body::before`.
- **`packages/console-ui/src/lib/cn.ts`** — `cn()` (clsx + tailwind-merge).
- **`packages/console-ui/src/ui/button.tsx`** — reference shadcn primitive (variants: default/secondary/outline/ghost/destructive; sizes default/sm/lg/icon). Match this style for all primitives.
- Deps installed: `class-variance-authority, clsx, tailwind-merge, @radix-ui/react-{slot,dialog,dropdown-menu,tooltip,separator,avatar}`, `tailwindcss@4, @tailwindcss/postcss, tw-animate-css`.
- `legacy console.css` import was removed from layouts; **screens are currently unstyled** — Phase 4 restyles them. **Delete `console.css`** once nothing imports it (also drop its `exports` entry in `console-ui/package.json`).

Conventions for all new files: `"use client"` where interactive; `cn()` for class merging; shadcn token classes only (e.g. `bg-card text-card-foreground border-border`, `text-muted-foreground`, `bg-primary text-primary-foreground`); lucide icons; export everything via `src/index.ts`.

## 3. Build order

### Phase 2 — primitives in `packages/console-ui/src/ui/` (shadcn-style)
Create each as its own file + a `ui/index.ts` barrel. Port standard shadcn/ui v4 sources, themed by our vars (no extra color overrides needed — tokens already map):
`badge.tsx` (variants below), `card.tsx` (Card/Header/Title/Description/Content/Footer), `input.tsx`, `separator.tsx`, `skeleton.tsx`, `avatar.tsx`, `dropdown-menu.tsx`, `sheet.tsx` (Radix Dialog → right-side drawer), `tooltip.tsx`, `table.tsx` (Table/Header/Body/Row/Head/Cell), `tabs.tsx`, `scroll-area.tsx` (optional), `badge`/`button` already patterned. Keep `Button` as-is.

`Badge` variants (the §4.7 status system): `neutral, info, success, warn, danger, critical, outline` — plus a small `StatusBadge` wrapper (in components, §3 Phase 3) that maps domain states → variant + label + dot/icon.

### Phase 3 — composed components in `packages/console-ui/src/components/` (replace `index.tsx`)
Split into files (or keep one file) but export all from `src/index.ts`:
- **`AppShell`** — `{ mode, surfaceLabel, modeBadge, nav, activePath, children }`: fixed Sidebar + sticky Topbar + scrollable content (`max-w` container, 24–32px padding).
- **`Sidebar`** — collapsible (icon-rail ↔ expanded; persist state). **Logo area** (amber keyhole SVG — reuse the one already in the old TopBar — + "ClueXP" wordmark in `font-condensed`). **Grouped nav** with section labels:
  - **Operations:** Dashboard, Live Queue, Dispatch Board, Map, Escalations
  - **Network:** Technicians, Teams, Documents
  - **Finance:** Reports (revenue/settlement)
  - **Admin:** Settings, Audit Log
  - Messages → under Operations. Active item: amber left-accent + `bg-sidebar-accent`. Tooltips when collapsed.
  - Provider surface hides ClueXP-only items (no platform Escalations ownership beyond escalate-to-ClueXP; no dispatch-policy). Drive via the `nav` prop per app.
- **`Topbar`** — global search (Cmd/Ctrl-K affordance), **environment badge** ("Production" — amber/neutral pill), **operational status** ("All systems operational" dot), **notifications** (bell + count, dropdown), **profile menu** (avatar → DropdownMenu: account, switch workspace, sign out). Keep the mode badge.
- **`PageHeader`** — `{ kicker?, title, description?, actions? }`. Strong condensed title, muted description.
- **`StatCard`** — `{ label, value, delta?, trend?, icon?, intent? }` — operational metric card (subtle border, hover, tabular-nums).
- **`StatusBadge`** — maps `ConsoleStatus` + trust + verification → Badge variant/label (see §4.7). 
- **`RequestTable`** — shadcn Table: sticky header, search/filter bar, column alignment (numeric right, tabular-nums), row hover, **row action DropdownMenu** (Open, Assign, Route, Escalate, Call…), status badges, **pagination** footer, empty state.
- **`DispatchQueue`** — dense queue list (cards/rows) with priority indicators; row → opens **RequestDrawer**.
- **`RequestDrawer`** — `Sheet` (right drawer) showing a job's detail: status + trust chip, access/situation, safety flags, assigned tech, SLA countdown, timeline, actions. Used from Queue/Board.
- **`TechnicianCard`** — avatar, name, skills, ETA/distance, eligibility badge, direct-release chip, trust/safety mini-indicators, actions (Assign / Send Offer / Hold / View Profile / Override).
- **`Timeline`** — vertical event list (actor, time, event, trust snapshot, metadata) — restyle current.
- **`SlaCountdown`** — `{ target | deadline }` from a backend timestamp; shows mm:ss, turns warn→danger as it nears 0; "SLA Risk" state.
- **`MapCard`** — bordered static map (job/tech markers + legend + service area + staleness) — restyle current MapPanel.
- **`EmptyState`** — `{ icon, title, description, action? }`.
- **`TrustSafety`** — panel/badges: Verified professional, Background check, License status, Insurance status, Payment risk, Customer no-show history.

### Phase 4 — screens + features (`packages/console-ui/src/screens/`)
Rewire all 10 existing screen views onto the new components (keep their logic/data + the §0.1 contracts), and add:
- **`Dashboard`** (NEW home; set each app root `/` → `/dashboard`): grid of `StatCard`s — **Live Requests, Average ETA, Active Professionals, SLA Risk, Revenue Today, Completion Rate** — plus a compact live-queue preview, an escalations/at-risk strip, and a recent-activity timeline. Realistic ClueXP emergency-access numbers (no ecommerce/crypto widgets).
- **Live Queue** → `PageHeader` + filter bar + `RequestTable`/`DispatchQueue`; row opens `RequestDrawer`.
- **Job Detail** → keep full page but rebuilt with Card/Tabs; ensure trust chip + safety flags + internal-notes separation; actions via Button/DropdownMenu.
- **Technician Assignment** → `TechnicianCard` list + job-context card + `SlaCountdown`/offer countdown + first-accept-wins note + map card.
- **Route to Organization / Org Job Intake / Dispatch Board / Map / Escalations / Documents / Audit** → restyle with the new components; board lanes stay `console_status`; documents table = `RequestTable`-style with action dropdown + approve/reject (cluexp only).
- Add **loading skeletons** (`Skeleton`) and **empty states** (`EmptyState`) where lists can be empty.

Add nav routes for `/dashboard` in both apps (`apps/*/src/app/dashboard/page.tsx`) and update `/` to redirect to `/dashboard`. Keep "Not in prototype" placeholders for any nav item without a screen.

## 4. Enterprise-polish checklist (the prompt — validate against this when done)
1. Spacing: 24/32px page padding, clean grid, aligned cards. ✅ target
2. Typography: strong titles, smaller secondary, clear hierarchy, no oversized text. (Phase 1 type scale exists.)
3. Sidebar: collapsible, clear active state, grouped (Operations/Network/Finance/Admin), logo area. (§3)
4. Header: global search, **Production** env badge, notifications, profile menu, operational status. (§3)
5. Dashboard: Live Requests / Avg ETA / Active Professionals / SLA Risk / Revenue Today / Completion Rate. (§4 Phase 4)
6. Cards: subtle borders, soft shadows only where needed, `rounded-md/lg`, empty states, skeletons.
7. Status badges: New, Assigned, En Route, On Site, Completed, Cancelled, **SLA Risk, Verification Pending, Verified** (map onto our `console_status`; "On Site" = `arrived`). Keep `console_status` as the source; badges are the presentation.
8. Tables: row spacing, sticky header, search/filter, column alignment, row hover, action dropdown, status badges, pagination.
9. Dispatch-first: live queue panel, **request detail side drawer**, priority indicators, technician assignment card, timeline, map placeholder card, **SLA countdown**.
10. Trust & safety: Verified professional, Background check, License status, Insurance status, Payment risk, Customer no-show history.

UI requirements: shadcn/ui consistently · lucide icons · Inter/Archivo · responsive · **dark only (no light mode needed)** · no lorem/cartoon/ecommerce/crypto · realistic ClueXP emergency-access data.

## 5. Mock data — extend `@cluexp/api-client` as needed
Add fields/datasets to support the new UI (keep existing intact): SLA target/deadline per job; per-technician trust/safety (`background_check`, `insurance_status`, `payment_risk`, `no_show_history`, `verified`); dashboard aggregates (live requests, avg ETA, active pros, SLA-risk count, revenue today, completion rate). Realistic locksmith/access values. Update `types.ts` + `mock-data.ts`.

## 6. Docs to update when done
- Add a short note to `docs/DESIGN-SYSTEM.md` (or a new `adr/0004`) recording that **consoles use shadcn/ui + Tailwind v4 themed to the same tokens**, while intake/technician remain hand-written CSS. Not drift — intentional per this migration.
- Update `docs/DISPATCH-CONSOLE-BUILD-PLAN.md` stack note (was "hand-written CSS, no Tailwind/shadcn" for consoles).

## 7. Acceptance
- `npm run typecheck`, `npm run build:ops`, `npm run build:provider` all pass.
- Both consoles render the new shadcn dark/amber look; mode distinction intact; all 10 screens restyled + Dashboard added; legacy `console.css` removed.
- Every §4 checklist item present; every §0.1 contract intact.
- Realistic data throughout; responsive; dark-only.
- Runtime smoke: `/dashboard`, `/queue` (+ drawer), `/board`, `/jobs/[id]`, `/jobs/[id]/assign`, `/map`, `/documents`, `/audit` on both apps.

## 8. Deploy / safety
- Work on `feat/sprint0-foundation`. Do **not** production-deploy (human-gated; the live consoles update only on an authorized prod deploy). Push commits; previews are fine.
- Raise questions in `docs/HANDOFF-codex.md`.
