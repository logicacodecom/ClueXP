# Dispatch Console — Build Plan (for Codex to execute)

> **Author:** Claude · **Date:** 2026-06-02 · **Executor:** Codex
> **Goal:** Build the dispatch console web surfaces from the design contract, as a
> real React/Next app — fixing the mock issues in code, not in PNGs.
> **Status:** Foundation scaffolded by Claude (see §9 "Already done"); the rest is for Codex.

## 0. Source of truth & precedence

Build to these, in this order of authority:
1. [`docs/ORGANIZATION-DISPATCH-CONSOLE-SPEC.md`](ORGANIZATION-DISPATCH-CONSOLE-SPEC.md) — the console UI/flow contract (states, screens, flows, data).
2. [`docs/DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) — visual tokens (the **dense console** variant, §7). Inherit; do not re-derive colors/type.
3. [`docs/adr/0003-dispatch-console-surfaces.md`](adr/0003-dispatch-console-surfaces.md) — two surfaces over a shared core.
4. [`docs/design-ref/ui/Dispatch/SPEC-REVIEW-FIXLIST.md`](design-ref/ui/Dispatch/SPEC-REVIEW-FIXLIST.md) — the mock review; **these fixes must be built in from the start** (§4 below).
5. The PNG mocks in `docs/design-ref/ui/Dispatch/*/screen.png` — visual reference **only**. Where a mock and the spec disagree, the spec wins.

**Hard contracts that must not break (SPEC §3.3, §7.1):**
- `console_status` (operator projection) and `Ticket.trust_state` (`INTAKE`→`MATCHED`→`FULFILLMENT`) are **separate**. `console_status` must never drive `trust_state`.
- Customer becomes `MATCHED` **only** when a named, verified technician is assigned — never on organization acceptance alone.
- Offer countdowns are driven by the backend `expires_at` value, never a client-invented timer.
- First-accept-wins is described as **backend-enforced** (UI states it; UI does not simulate the race).

## 1. Decisions locked (from the human, 2026-06-02)

- **Architecture:** ADR-0003 correct — npm-workspace monorepo, a shared `@cluexp/console-ui` core consumed by two thin apps (`ops-web`, `provider-web`). No copy-paste between apps.
- **Scope:** build **all 10 prioritized screens, both modes** now (org-managed screens are "designed-ahead" per SPEC build-status; we build them anyway by decision).
- **Data:** local **mock data only** (SPEC §14). No real API calls, no auth, no real maps. A `@cluexp/api-client` package holds types + mock data as the seam where real endpoints land later (SPEC §11).
- **Updated console stack:** the console apps now use **Next.js 16 (App Router) + React 19 + lucide-react + Tailwind v4 + shadcn-style primitives**, themed to the ClueXP dark/amber design tokens. Intake/technician remain hand-written CSS.

Roadmap fit (`docs/ROADMAP.md`): `console-ui` shared; `provider-web` = E2, `ops-web` = E7. This task builds the UI shell ahead of backend wiring.

## 2. Final directory layout

```
intake/
├─ package.json                 # npm workspaces root  [DONE]
├─ tsconfig.base.json           # shared TS config      [DONE]
├─ apps/
│  ├─ intake-web/               # existing (untouched except workspace name) [DONE]
│  ├─ ops-web/                  # NEW — ClueXP mode surface
│  └─ provider-web/             # NEW — Organization mode surface
└─ packages/
   ├─ api-client/               # NEW — types + mock data  [DONE]
   │  └─ src/{types.ts,mock-data.ts,index.ts}
   └─ console-ui/               # NEW — shared shell + components + 10 screens
      └─ src/
         ├─ globals.css         # Tailwind v4 + shadcn token theme (single import)
         ├─ components/         # shared primitives
         ├─ screens/            # the 10 screen views
         └─ index.ts            # barrel export
```

### Wiring rules (important)
- Shared packages export **TypeScript source** (no build step). Each Next app must set
  `transpilePackages: ["@cluexp/console-ui", "@cluexp/api-client"]` in `next.config.ts`.
- `@cluexp/console-ui` `package.json` already declares `react`/`react-dom`/`lucide-react`
  as **peerDependencies** (apps provide them) and depends on `@cluexp/api-client`.
- Screens/components that use state/effects/handlers are **client components** (`"use client"`).
  Pure presentational pieces can stay server components, but when in doubt mark `"use client"`
  (these are interactive console screens).
- Each app imports the shared Tailwind theme once via app `globals.css`: `@import "@cluexp/console-ui/globals.css";`

## 3. Screen → app (mode) mapping

`console-ui` owns every screen as a reusable view; each app mounts the routes for its surface
and passes `mode`. Shared screens accept `mode: "cluexp" | "org"` and scope data/actions.

| # | Screen (spec) | console-ui view | ops-web (ClueXP) | provider-web (Org) |
|---|---|---|---|---|
| 1 | Live Queue §8.2 | `LiveQueue` | ✅ `/queue` (platform-wide) | ✅ `/queue` (org-scoped) |
| 2 | Job Detail §8.3 | `JobDetail` | ✅ `/jobs/[id]` | ✅ `/jobs/[id]` |
| 3 | Technician Assignment §8.6 | `TechnicianAssignment` | ✅ `/jobs/[id]/assign` (individual + direct-release) | ✅ `/jobs/[id]/assign` (affiliated) |
| 4 | Route to Organization §8.4 | `RouteToOrganization` | ✅ `/jobs/[id]/route` | — (ClueXP action) |
| 5 | Organization Job Intake §8.5 | `OrgJobIntake` | — | ✅ `/intake/[id]` |
| 6 | Dispatch Board §8.7 | `DispatchBoard` | ✅ `/board` | ✅ `/board` |
| 7 | Map Operations §8.8 | `MapOperations` | ✅ `/map` | ✅ `/map` |
| 8 | Escalation Queue §8.12 | `EscalationQueue` | ✅ `/escalations` | ✅ (escalate-to-ClueXP only) |
| 9 | Documents / Compliance §8.13 | `DocumentsCompliance` | ✅ `/documents` (approve/reject) | ✅ `/documents` (view/request) |
| 10 | Audit Log §8.16 | `AuditLog` | ✅ `/audit` | ✅ `/audit` |

Left-nav per SPEC §6: Live Queue · Dispatch Board · Map · Technicians · Teams · Messages ·
Documents · Reports · Settings · Audit Log. (Build nav items for all; only the 10 screens above
need real content this pass — the rest can route to a simple "Not in this prototype" placeholder.)

## 4. Fix-list — build these in from the start (do NOT reproduce the mock flaws)

From `SPEC-REVIEW-FIXLIST.md`. Each is a build requirement, not a later cleanup:

**P0**
- **Dispatch Board lanes = `console_status`, not trust-state.** Columns: *Awaiting assignment,
  Offer sent, Accepted, En route, Arrived, In service, Approval needed, Completed, Escalated*
  (SPEC §8.7). Show `trust_state` only as a small per-card chip — never as the board axis.
  Stalled jobs float to the top.
- **Technician Assignment is locksmith/access domain** (car/home/business lockout, broken/lost
  key, rekey, key programming) — **never HVAC/plumbing/electrical**. Use the mock job + candidates
  from `@cluexp/api-client`.
- **Map Operations uses factual operational copy** — no "deploy asset / operatives / recon-alpha".
  Provide: distinct **job vs technician markers + a legend**, a **service-area polygon**, and
  **route/ETA + location-staleness** affordances (static is fine — SPEC §8.8; no fake movement).

**P1**
- **Direct-release affiliated technician** shown as a `DIRECT-RELEASE` chip (membership-level,
  marked future/planned) on eligible affiliated techs (SPEC §3.2, DoD #5). `tech-samir` in the
  mock has `direct_dispatch_allowed: true`.
- **Offer-based dispatch** on Technician Assignment: actions `Send Offer` / `Hold/Reserve` /
  `View Profile` / `Assign` / `Override Block`; an offer-status chip; a countdown sourced from
  `offer.expires_at`; and a visible note that acceptance is **backend-enforced first-accept-wins**.
- **Job Detail** must surface a **trust-state chip** (clearly separated from `console_status`),
  **safety flags**, and **access-type/situation** chips; actions include Assign, Route, Reassign,
  Cancel, Escalate, Message/Call, Add Internal Note. Internal notes panel must be visually
  distinct from customer/technician messages (DoD #9).
- **Audit Log** `trust_state` column uses only `INTAKE | MATCHED | FULFILLMENT` (no invented
  sub-states like "INTAKE DEGRADED"). Severity goes in a separate field, not the trust column.

**P2**
- **One wordmark** across all screens (no `CXP` vs `CLUEXP` drift) — SPEC §5.
- Live Queue: add `Call Customer` / `Call Technician` (overflow ok) and expose filter facets
  (source, access type, situation, urgency, area, team, age, trust-state, escalation reason).
- Route to Organization: per-org historical response time + a `Route to Team` affordance.

## 5. Design system (the dense console variant)

Token values are fixed in `DESIGN-SYSTEM.md` / shared console `globals.css`:
- `--bg #0e0e0e`, `--surface #1c1b1b`, `--surface-high #2a2a2a`, `--text #e5e2e1`,
  `--muted #d4c5ab`, `--line #504532`, `--primary #ffbf00`, `--primary-soft #ffe2ab`,
  `--primary-text #261a00`, `--secondary #2563eb`, `--secondary-soft #b4c5ff`,
  `--danger #ffb4ab`, `active-fill #2a240d`, `--success #3fb950`.
- **Type:** `"Arial Narrow", "Archivo Narrow", Arial, sans-serif`; weights 800 headings/900
  buttons-panel-titles, 500 secondary; uppercase kickers/panel-titles.
- **Shape:** 4px radius everywhere; 1px borders `rgba(255,255,255,0.12)`, amber on active.
- **Backdrop:** faint amber 44px grid (reuse the `.shell` gradient from intake `globals.css`).
- **Density (console):** compact rows (~40–48px), tables, multi-panel split views, persistent
  left-nav + sticky top bar. No decorative dashboards, no hero sections, no fake movement.
- **Semantic status chips:** text/icon + color, never color alone. Map `console_status` and
  eligibility states to chip colors (online/accepted=green, en-route/route=blue,
  alert/expiring=amber→red critical, blocked/expired=danger/desaturated).
- **Focus ring:** `2px solid --primary`, 3px offset on every interactive element.
- **Touch targets:** ≥44px floor.

## 6. Component & screen specs (console-ui/src)

### 6a. Shared primitives — `components/`
- **`Shell.tsx`** — app frame: sticky `TopBar` + `LeftNav` + content area. Props:
  `mode`, `surfaceLabel` (e.g. "OPERATIONS CONSOLE"), `modeBadge` ("CLUEXP MODE" /
  "ORGANIZATION MODE: <org>"), `nav` items, `children`. Renders the amber-grid backdrop.
- **`TopBar.tsx`** — single consistent wordmark (amber mark + "CLUEXP" + uppercase subtitle),
  search input, mode badge, notification/help/account slots.
- **`LeftNav.tsx`** — the SPEC §6 sections with lucide icons; active state = amber.
- **`StatusChip.tsx`** — `status: ConsoleStatus | TechnicianEligibility | OrganizationEligibility | OfferStatus`;
  resolves label + semantic color + icon. Text+color always.
- **`TrustStateChip.tsx`** — only `INTAKE | MATCHED | FULFILLMENT`; visually distinct from
  StatusChip (e.g. outlined) so it never reads as a console state.
- **`UrgencyTag.tsx`**, **`SafetyFlag.tsx`** (warning/critical styling, non-theatrical copy).
- **`QueueRow.tsx`** — compact job row (type icon, id, routing source, area, status chip,
  urgency, row actions). Keyboard-focusable.
- **`DataTable.tsx`** — generic dense table (header row + compact body rows).
- **`Panel.tsx`** — bordered surface card with uppercase soft-amber `panel-title`.
- **`SplitView.tsx`** — table/queue + detail panel layout.
- **`TechnicianRow.tsx`** — picker row: initials avatar, name/id, skills, ETA/distance,
  eligibility chip, direct-release chip, workload, doc status, actions.
- **`Timeline.tsx`** — vertical event list (actor, time, event, trust-state snapshot, metadata).
- **`MapPanel.tsx`** — bordered static "map" (reuse intake `.map` texture). Renders job markers
  (amber) vs technician markers (blue) with a **legend**, an optional **service-area polygon**
  outline, and staleness indicator. No animation.
- **`Countdown.tsx`** — formats remaining time from an ISO `expires_at` (computes from prop;
  may tick with `setInterval` for display only — the authority is `expires_at`). Show
  `--:--` / "expired" past deadline.
- **`OfferStatusChip.tsx`** — `OfferStatus` values.
- **`Toolbar.tsx` / `FilterBar.tsx`** — filter facet chips + search.

### 6b. The 10 screens — `screens/`
Each is `({ mode, ... }) => JSX`, pulling from `@cluexp/api-client`. Match the named mock layout
but apply §4 fixes.

1. **`LiveQueue.tsx`** — toolbar + filter facets; dense `QueueRow` list ordered with
   expiring/safety/stalled first (SPEC §8.2 rule). Row actions: Open, Route, Assign, Escalate,
   Call Customer, Call Technician. Footer metric tiles (queue depth, avg response, active techs,
   critical alerts). `mode=org` filters to the active org's jobs only.
2. **`JobDetail.tsx`** — SplitView: customer safe-display + access-type/situation chips +
   **safety flags** + dispatch-owner + assigned technician + **TrustStateChip** + price/approval;
   `Timeline` of events; **distinct internal-notes panel**; action bar (Assign, Route, Reassign,
   Cancel, Escalate, Message/Call, Add Note). Header shows `console_status` chip AND a separate
   trust-state chip.
3. **`TechnicianAssignment.tsx`** — candidate list of `TechnicianRow` (access-domain skills);
   eligible techs get Assign / **Send Offer** / **Hold** / View Profile; blocked techs
   (e.g. Marcus Vale, license expired) show the blocker + **Override Block** (reason capture).
   Show **direct-release** chip for `direct_dispatch_allowed` affiliated techs (cluexp mode).
   Right rail: map, job context, smart-suggestion, and a **"first-accept-wins enforced by
   backend"** note. Offer rows show `Countdown` from `expires_at`.
4. **`RouteToOrganization.tsx`** (cluexp) — eligible orgs list with distance, workload, rating,
   **historical response time**, document status; blocked orgs (City Wide Lock, insurance
   expired) show `ACTIONS LOCKED`. Actions: Route to Organization, **Route to Team**, Skip,
   Escalate, View Profile. Copy makes clear routing ≠ customer MATCHED.
5. **`OrgJobIntake.tsx`** (org) — incoming-request card with `Countdown` (from `expires_at`),
   job type/location/access/situation/urgency, available technicians rail; actions Accept /
   Decline (reason capture) / Assign Technician / Ask ClueXP. A line stating acceptance is an
   internal milestone — customer is **not** MATCHED until a technician is assigned.
6. **`DispatchBoard.tsx`** — kanban with **console_status lanes** (see §4 P0). Compact job cards
   (id, type, technician, org/team, age, ETA, last event, warnings). Per-card small trust-state
   chip. Stalled cards float to top. Footer status strip.
7. **`MapOperations.tsx`** — left filter rail (Active Technicians / Pending Jobs / Emergency
   Alerts counts; service-team filters with access-trade names; quick actions incl. "Assign from
   Map"/"Dispatch"); `MapPanel` with job vs tech markers + legend + service-area polygon +
   staleness. Factual copy only.
8. **`EscalationQueue.tsx`** — rows of escalations (reason, urgency) with Take Ownership, Contact
   Customer/Technician, Reassign, Cancel, Mark Resolved; right rail active-tech map + escalation
   audit log. Reasons from spec list; **no law-enforcement/theatrical language**.
9. **`DocumentsCompliance.tsx`** — compliance matrix table (entity, type, category, doc status,
   last verified, actions). Tabs All/Organizations/Technicians. Actions: View, Request Update,
   Approve/Reject (**ops/admin only**), Suspend, Block/Unblock (permission-gated). Network-health /
   action-required tiles.
10. **`AuditLog.tsx`** — append-only event trail for a job: actor, timestamp, event,
    **trust_state (INTAKE/MATCHED/FULFILLMENT only)**, threshold/reason/metadata; internal
    metadata JSON block; "integrity verified" footer. Export + Resolve Escalation actions.

### 6c. `index.ts`
Barrel-export all components + screens + re-export `@cluexp/api-client` types for app convenience.

## 7. The two apps (thin shells)

For **each** of `apps/ops-web` and `apps/provider-web`:
- `package.json` — name `@cluexp/ops-web` / `@cluexp/provider-web`; deps: `next ^16`,
  `react ^19`, `react-dom ^19`, `lucide-react ^0.468`, `@cluexp/console-ui` `*`,
  `@cluexp/api-client` `*`; devDeps mirror intake-web; scripts `dev`/`build`/`lint`. Use
  distinct dev ports (ops-web `3001`, provider-web `3002`; intake-web keeps `3000`).
- `next.config.ts` — `transpilePackages: ["@cluexp/console-ui", "@cluexp/api-client"]`.
- `tsconfig.json` — extend a Next-appropriate config (copy intake-web's, add path alias `@/*`).
- `src/app/globals.css` — `@import "@cluexp/console-ui/globals.css";`; layouts set fonts, `<html className="dark ...">`, and metadata
  (ops: "ClueXP Operations Console"; provider: "ClueXP Provider Console").
- `src/app/` routes per §3 table; each page renders the matching `console-ui` screen wrapped in
  `<Shell mode=... surfaceLabel=... modeBadge=... nav=...>`. `ops-web` passes `mode="cluexp"`,
  `provider-web` passes `mode="org"` and the active org (`Metro Key Partners` from mock).
- Root `/` redirects to `/queue`.

Mode must be **visibly distinct** (DoD #1): ops-web shows "CLUEXP MODE"; provider-web shows
"ORGANIZATION MODE: METRO KEY PARTNERS".

## 8. Acceptance criteria

**Build/run**
- `npm install` at root links the workspace; `npm run dev:ops` and `npm run dev:provider` both
  boot; `npm run build:ops` and `npm run build:provider` both succeed. `typecheck` passes.
- intake-web still builds/runs unchanged.

**Spec DoD (SPEC §15) — all must hold**
- Org mode and ClueXP mode visibly distinct.
- All 10 screens represented and reachable via nav/routes.
- Org-managed flow shows route-to-org → org accept → technician assignment, and customer
  `MATCHED` only after technician assignment.
- ClueXP flow shows individual-technician dispatch.
- Direct-release state represented as future/planned.
- Ineligible technician/organization blockers visible.
- First-accept-wins described as backend-enforced.
- Offer timers use `expires_at`.
- Internal notes visually separate from customer/technician messages.
- No screen implies org acceptance alone = customer-visible matching.

**Fix-list (§4) — all P0 and P1 satisfied; P2 addressed.**

## 9. Already done by Claude (do not redo — extend)

These files exist and are correct; build on them:
- `package.json` (root, npm workspaces) — workspaces: `apps/*`, `packages/console-ui`, `packages/api-client`; dev/build scripts.
- `tsconfig.base.json`.
- `apps/intake-web/package.json` — added `name: "@cluexp/intake-web"` + `private` (only change to intake).
- `packages/api-client/` — `package.json`, `tsconfig.json`, `src/types.ts`, `src/mock-data.ts`, `src/index.ts`. **Types mirror SPEC §7/§10 exactly; mock data is the access-domain §13 demo set. Reuse these — do not rename state values.**
- `packages/console-ui/package.json`, `packages/console-ui/tsconfig.json` (peerDeps + api-client dep set).

**Historical note:** initial pass built `packages/console-ui/src/*`; later migration replaced legacy `console.css` with Tailwind v4 `globals.css` and shadcn-style primitives.
both apps under `apps/`, then install + typecheck + build + smoke both surfaces.

## 10.5 Deployment & domains (decided 2026-06-02)

Three separate deployable apps in this one monorepo — **separate Vercel projects, separate
domains, separate auth surfaces** (the ADR-0003 tenant-isolation boundary: org dispatchers and
ClueXP ops must not share a bundle/domain).

| App (folder) | Audience | Subdomain (target) | Vercel project | Status |
|---|---|---|---|---|
| `apps/intake-web` | Customers | `intake.cluexp.com` | `cluexp-intake` | ✅ live at `intake.cluexp.com` (HTTP 200) **and** `www.cluexp.com`; `www` to be repurposed for the public site later |
| `apps/ops-web` | ClueXP internal operations/admin/dispatch console | `ops.cluexp.com` | `cluexp-ops` | ✅ project created + **production-deployed** from `feat/sprint0-foundation`; domain assigned — **pending `ops` CNAME** at registrar |
| `apps/provider-web` | Provider partner orgs | `partners.cluexp.com` | `cluexp-provider` | ✅ project created + **production-deployed** from `feat/sprint0-foundation`; domain assigned — **pending `partners` CNAME** at registrar |
| _(future)_ public marketing site | Public | `cluexp.com` / `www.cluexp.com` | TBD | not built — `www` to be repurposed from intake later |

> **Provisioned 2026-06-03 (via Vercel REST API).** `cluexp-ops` (rootDir `apps/ops-web`) and
> `cluexp-provider` (rootDir `apps/provider-web`) created, Git-connected to `logicacodecom/ClueXP`,
> and production-deployed from `feat/sprint0-foundation` (monorepo workspaces resolve on Vercel; no
> install-command override needed). Domains `ops.cluexp.com` / `partners.cluexp.com` / `intake.cluexp.com`
> assigned. `cluexp.com` is on team `logicacode-projects` with **third-party nameservers**, so
> `ops` + `partners` each need a `CNAME → cname.vercel-dns.com` at the registrar to resolve
> (`intake` already routes). Vercel CLI v54 can't set a project's Root Directory — that's why this
> was done over the REST API, not the CLI. Production deploys are still human-authorized per HANDOFF.
> **Production branch:** projects deploy from `feat/sprint0-foundation`; auto-promotion on push waits
> until that branch merges to `main` (PR #2) or each project's production branch is changed in settings.

Vercel setup for each new app: create a project pointing at the **same repo**, set **Root
Directory** = `apps/provider-web` / `apps/ops-web`, framework = Next.js, then bind the custom
domain. Because shared code lives in `packages/*` (outside the root dir), each project needs the
monorepo install to resolve workspaces — set the project **Install Command** to run at the repo
root (e.g. `npm install` from root) and keep `transpilePackages` (§2) so the app compiles the
shared TS source. Do **not** merge the two consoles onto one domain. Production promotion stays
human-authorized (see HANDOFF hard rules); ship previews first.

## 10.6 Cross-app config gotchas
- Root `vercel.json`/`.vercelignore` currently target intake-web only — add per-project config
  rather than globally ignoring the new apps. Confirm the existing `cluexp-intake` project is
  unaffected (its Root Directory should already be `apps/intake-web`).
- Env vars are per Vercel project; the consoles need none for the mock-data pass.

## 10. Gotchas / notes
- Next 16 + React 19 + workspace TS source ⇒ `transpilePackages` is required or imports fail.
- Keep everything **mock-data driven**; the only seam for real data is `@cluexp/api-client`
  (mirrors SPEC §11 endpoint shape for later).
- Tailwind/shadcn-style primitives are intentional for consoles; keep intake/technician stack separate.
- Don't fake live movement on the map (SPEC §8.8 / §12).
- Don't invent trust sub-states anywhere. `console_status` ≠ `trust_state`, ever.
- Commit on a feature branch; do not promote to prod. Raise questions in `HANDOFF.md`.
