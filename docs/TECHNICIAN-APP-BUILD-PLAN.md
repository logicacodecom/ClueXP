# Technician App — Build Plan (historical)

> **Status:** The PWA is built and deployed. This file remains an implementation
> and design reference; use `EXECUTION-PLAN.md` for current production wiring
> priorities.

> **Author:** Claude · **Date:** 2026-06-03 · **Executor:** Codex
> **Goal:** Build the **ClueXP Technician mobile app** as a new PWA — an *Uber-grade,
> field-first* experience — from `TECHNICIAN-MOBILE-SPEC.md`. Mock-data only, no backend.
> **Why now:** it's the third surface that closes the loop (customer intake → ops/provider
> dispatch → **technician**) for an end-to-end whole-picture demo.

## 0. Source of truth & precedence
1. `docs/TECHNICIAN-MOBILE-SPEC.md` — the screen/flow/state contract (§5 IA, §6 states, §7 lifecycle, §8 screens, §9 flows, §13 style, §14 demo, §16 DoD, §18 prompt).
2. This file — execution order, stack, and the **Uber-grade quality bar**.
3. `docs/DESIGN-SYSTEM.md` — brand tokens (mobile/field variant, §7).
4. `docs/adr/0002-identity-and-clients.md` — auth/clients direction (PWA → React Native later).

**Hard contracts (do not break):**
- **Honest status** (spec §3.2): no fake customer data, ETA, route, movement, or acceptance.
- **Don't expose customer/job detail before acceptance/assignment** (spec §16, DoD).
- **Technician statuses ≠ customer `trust_state`.** Accepting an offer does **not** by itself make the customer `MATCHED`; that's the named-technician assignment event owned by the backend.
- Technician job statuses are a **projection over the same backend events as the console's `console_status`** (ORG-DISPATCH-CONSOLE-SPEC §7.1) — e.g. technician `en_route` and console `en_route` are the *same* event from each side. Don't invent a separate lifecycle; map to the shared statuses in `@cluexp/api-client`.
- **Offer timers use backend `expires_at`; first-accept-wins is backend-enforced** — the UI only reflects the result, including the **"another technician accepted first" (superseded)** state.
- **Individual vs affiliated** distinction visible; affiliated = **organization-managed by default**, with **direct ClueXP dispatch only when released** (membership-level; SPEC §2.10). Don't change a tech's global provider type to represent release.
- **Location states** (active / stale / blocked / low-accuracy) and **compliance-blocking** (expired docs block availability) are represented.
- **Customer privacy:** only job-necessary info; phone masked/mediated.

## 1. Decisions (locked with the human 2026-06-03 — flag here to change)
- **"Like Uber" = Uber's interaction patterns + production polish, NOT Uber's palette.** Keep the **ClueXP dark + amber** brand (mobile/field variant). Borrow Uber's UX: full-screen ride-request-style **incoming offer with a large countdown + decisive accept/decline**, **map-forward active job**, **bottom action sheets**, big thumb targets, persistent **active-job bar**, smooth state transitions.
- **Stack:** new **`apps/technician-web`** — Next.js 16 (App Router) + React 19 + **Tailwind v4** + lucide-react, themed to the **same ClueXP tokens** as the consoles (mobile-tuned). **PWA** (manifest + installable + mobile viewport). Components live **in-app** (`src/components`) — it's a single app, so no shared `console-ui`-style package is needed; it consumes shared **`@cluexp/api-client`**.
- **Aesthetic specifics** (spec §13): high contrast, large action buttons, compact status panels, minimal decoration, no marketing hero. **Strong alarm color (amber→red) ONLY** on the incoming-offer alert + urgent warnings. Green = online/ready, blue = route/navigation.
- **Scope:** the **full app** (5 tabs / 19 screens per spec §8), with the **live dispatch loop as the Uber-polish priority** (see §3 tiers). Mock-only.
- **Data:** reuse `@cluexp/api-client` (same demo Jobs A/B/C as the consoles → cross-surface story). Extend it with technician-POV mock (availability, GPS, current offer, earnings, history) — §6.
- **Deploy:** out of scope here. Future Vercel project `cluexp-tech` + domain TBD (candidate `tech.cluexp.com`); **do not deploy**.

## 2. Directory & wiring
```
apps/technician-web/
├─ package.json            # @cluexp/technician-web; deps: next, react, react-dom, lucide-react,
│                          #   @cluexp/api-client; dev: tailwind v4 + @tailwindcss/postcss, types
├─ next.config.ts          # transpilePackages: ["@cluexp/api-client"]
├─ postcss.config.mjs      # @tailwindcss/postcss
├─ tsconfig.json           # extend repo style (copy ops-web)
├─ public/manifest.webmanifest, icons   # PWA
└─ src/
   ├─ app/
   │  ├─ layout.tsx        # dark; fonts via next/font/local (reuse Inter+Archivo woff2 — see note);
   │  │                    #   mobile viewport + theme-color; renders the phone frame
   │  ├─ globals.css       # @import "tailwindcss"; ClueXP dark/amber tokens (mobile-tuned) + @theme
   │  ├─ (tabs)/jobs|map|messages|activity|profile/page.tsx   # 5 bottom-nav tabs
   │  ├─ jobs/[id]/page.tsx           # active job overview
   │  ├─ jobs/[id]/navigate|arrival|service|complete/...      # active-job sub-flow
   │  ├─ offer/[id]/page.tsx          # full-screen incoming offer (or modal route)
   │  ├─ onboarding/, signin/         # §8.1–8.3
   │  └─ page.tsx          # launch/session restore → /jobs
   └─ components/          # mobile component library (§4)
```
- Workspace: add `apps/technician-web` to root `package.json` workspaces + scripts `dev:tech` (port **3003**), `build:tech`.
- **Fonts:** reuse the committed self-hosted woff2 at `packages/console-ui/src/fonts/` via `next/font/local` (same approach as consoles — no Google Fonts fetch).
- **Theme:** mirror the ClueXP dark/amber tokens (canonical in `DESIGN-SYSTEM.md`). Mobile-tuned: ≥44px touch targets, larger type, bottom-safe-area padding. Don't import the console's dense `globals.css`.
- **Desktop presentation:** mobile-first; on wide screens, center the app in a **phone-width frame** (`max-w-[460px]`, device chrome optional) so it demos like a phone.

## 3. Screens — build order & priority tiers (map to spec §8)
**Tier 1 — the Uber-grade live loop (do first, highest polish):**
- §8.4 **Jobs Home** — availability toggle (online/offline/break), GPS status, auto-accept switch, active-job card, assigned queue.
- §8.5 **Incoming Job Alert** — full-screen takeover; large **countdown from `expires_at`**; Accept / Decline (decline = reason); source badge (ClueXP vs Organization); sound/vibration-ready states (mocked, with a visible "enable sound" affordance — autoplay can't be assumed); the **superseded** ("another technician accepted first") state.
- §8.6 **Active Job Overview** — status, safe customer info, access type/situation, map preview, primary actions; persistent **active-job bar** across tabs.
- §8.7 **Navigation / Map** — full-bleed static map (route/ETA placeholder, location accuracy/staleness; no fake movement).
- §8.10 **Arrival Verification** — mutual PIN/QR handshake.
- §8.11 **In-Service** → §8.12 **Customer Approval Needed** → §8.13 **Complete Job**.

**Tier 2 — supporting (functional, good but not the wow):**
- §8.8 **Customer Chat** (quick replies, masked identity), §8.9 **Voice/Call** (stateful placeholder).
- §8.15 **Activity / Earnings** (provisional settlement visibility — not final), §8.14 **Job History**.
- §8.16 **Profile** (availability, auto-accept, teams, settings entry), §8.17 **Documents/Compliance** (blocking states), §8.18 **Team/Organization view** (affiliated only).

**Tier 3 — entry/edges:**
- §8.1 Launch/Session Restore, §8.2 Sign In, §8.3 Onboarding Permissions, §8.19 Settings.

Bottom nav (spec §5): **Jobs · Map · Messages · Activity · Profile**; active-job screen takes priority over tabs when a job is active.

## 4. Mobile component inventory (in `src/components`)
- **AppFrame** (phone frame + safe areas), **BottomNav** (5 tabs, active state), **TopStatusBar** (availability + GPS + active-job state, sticky).
- **AvailabilityToggle** (online/offline/break; green=ready), **GpsStatusPill** (active/stale/blocked/low-accuracy), **AutoAcceptSwitch**.
- **IncomingOfferAlert** (full-screen: source, access/situation, distance/ETA, **CountdownRing/Bar from `expires_at`**, Accept/Decline, superseded state, sound-enable prompt) — the centerpiece; Uber-grade.
- **ActiveJobBar** (persistent), **JobCard** (queue/home), **StatusPill** (technician job statuses, text+color), **SourceBadge** (ClueXP / Organization+team), **SafetyFlag**.
- **MapView** (full-bleed static, markers/route/staleness), **ActionSheet** (bottom sheet for actions), **ArrivalCode** (PIN/QR), **ChatThread** + **QuickReplies**, **CallScreen** (placeholder), **EarningsCard**, **DocStatusRow** (compliance/blocking), **TeamBadge**, **EmptyState**, **Skeleton**.

**Uber-grade quality bar:** one clear primary action per screen; thumb-reachable; instant, smooth transitions (respect `prefers-reduced-motion`); the incoming offer is impossible to miss; honest empty/loading/blocked states; no decorative noise; status always text+icon+color (never color alone).

## 5. Cross-surface state mapping (keep one story)
Technician statuses must line up with the shared events the consoles read. Use/extend the
`@cluexp/api-client` job + offer + event model so the **same Job A/B/C** can be told from the
technician POV: an **offer** (`expires_at`, target = this technician) → **accept** → the job's
`technician_id` is set (the assignment event) → `en_route`/`arrived`/`in_service`/`completed`
mirror the console lanes. Affiliated Job B shows **Organization (Metro Key Partners) / Home Team**
source; individual Jobs A/C show **ClueXP** source. Reconcile any distance/ETA differences between
spec §14 and the api-client mock by **using the api-client values** (single source of mock truth).

## 6. Mock data — extend `@cluexp/api-client` (keep existing intact)
Add a technician-POV slice: current technician identity + **availability** (`offline|online|busy|break|blocked_by_documents|suspended`), **GPS state**, **auto_accept** flag, an **active offer** addressed to the technician (with `expires_at`), assigned-job queue, **activity/earnings** (provisional), and **job history**. Realistic locksmith/access values. Update `types.ts` + `mock-data.ts`; export helpers (e.g. `currentTechnician`, `activeOffer`, `technicianJobs`).

## 7. PWA specifics
- `manifest.webmanifest` (name, short_name, theme/background `#0c0d10`, display `standalone`, icons), linked in layout; mobile `viewport` (`width=device-width, viewport-fit=cover`) + `theme-color`.
- Installable; **offline service worker is out of scope** for this pass (note it).
- Sound/alarm: provide the UI + an explicit "enable sound" interaction (browsers block autoplay) — mocked.

## 8. Acceptance (matches spec §16 DoD)
- Workspace builds: `npm run build:tech` + `typecheck` pass; root `dev:tech` boots (port 3003).
- All §8 core screens navigable; **manual accept** loop works end-to-end on mock data; **auto-accept** visible/testable; incoming alert has visual + sound-ready states; GPS states represented; active-job flow reaches **arrival → complete**; chat + call placeholders exist; individual vs affiliated context visible; org/team context for affiliated; documents/compliance blocking visible.
- **No trust-state violation:** no customer/sensitive data before acceptance/assignment; accepting ≠ customer `MATCHED`.
- Uber-grade polish on Tier-1; ClueXP dark+amber brand; responsive/mobile + phone-frame on desktop; realistic data; no fake movement/ETA.

## 9. Deploy / safety
- Branch `feat/sprint0-foundation` (or a sub-branch). **No production deploy** — human-gated.
- Raise questions in `docs/HANDOFF-codex.md`. I'll review against this plan + the spec + DoD when done.

## 10. Suggested phasing (checkpoint per phase)
1. Scaffold app + workspace + Tailwind/theme + fonts + PWA shell + BottomNav/AppFrame → build smoke.
2. api-client technician slice (§6).
3. Tier-1 live loop (Jobs Home → Incoming Offer → Active Job → Map → Arrival → In-Service → Complete).
4. Tier-2 + Tier-3 screens.
5. Build + smoke; update `ROADMAP`/`EXECUTION-PLAN` status; (no deploy).
