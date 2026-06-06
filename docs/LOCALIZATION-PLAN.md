# ClueXP Localization (i18n) Build Plan — EN/ES, extensible

> **Status:** APPROVED (human, 2026-06-05) — decisions locked below; Codex executes on go.
> **Owner split:** Codex = app/UI code (strings, catalogs, components, switcher, translations).
> Claude = infra seam (locale routing/middleware, SEO `hreflang`, deploy/env, backend error-code
> coordination, review). Where they couple, coordinate in `docs/HANDOFF-codex.md`.

## 0. Decisions (defaults chosen; 🔑 = needs human sign-off)
- **Library:** **next-intl** — App Router + RSC native, ICU MessageFormat, monorepo-friendly. One
  library across all four apps for consistency. *(Optional later: evaluate Paraglide for
  `technician-web` only if PWA bundle size becomes a concern — not now.)*
- **Locales:** `en` (default/source) + `es`. Architecture must make adding a third locale a
  data-only change (drop in a new catalog), never a code change.
- **Rollout order** (external-user exposure, per handoff): **1) intake → 2) technician →
  3) provider → 4) ops.**
- **Translate-now vs wrap-now:** fully translate **intake + technician** (EN/ES). For **provider +
  ops**, wrap all strings in `t()` now but **defer the ES catalog** until they're wired to the live
  API and stable (avoid translating churning mock copy).
- **Source of truth:** `en` catalog. `es` = AI first pass against a reviewed glossary + native review.
- **Units (distance/ETA):** **miles** for both locales (confirmed 2026-06-05).
- **Spanish variant:** **Latin American Spanish (es‑419 / US‑Latino)** — right for the US
  urgent-services market, not Castilian (es‑ES). Locked as default; override only if asked.
- **Governance:** once the foundation lands, **all new UI text must use translation keys** —
  enforced mechanically by lint (see §10), not by reviewer diligence.
- **Translate by complete workflow, never scattered screens** — a workflow is the unit of done
  (see §2b). No half-translated journey.
- **Catalogs hold static UI copy only** — never DB / customer / user-generated content (see §6).

## 1. Shared foundation — `packages/i18n` (NEW workspace package `@cluexp/i18n`)
Mirrors the existing `@cluexp/console-ui` / `@cluexp/api-client` pattern. Add to root
`workspaces`. Contents:
- `src/config.ts` — `locales = ['en','es'] as const`, `defaultLocale = 'en'`, `localeCookie = 'NEXT_LOCALE'`, typed `Locale` union, `localeLabels` (`{ en: 'English', es: 'Español' }`).
- `src/request.ts` — next-intl request config helper shared by apps (loads the right catalog by locale + namespace).
- `src/formatting.ts` — thin wrappers / presets for `useFormatter` (date, time, number, currency, relativeTime) so every surface formats consistently.
- `src/messages/common/{en,es}.json` — **shared** strings used by `console-ui` components (buttons, status labels, table chrome, empty/skeleton, nav). App-specific strings stay in each app.
- `src/index.ts` — re-exports config + helpers + a `LocaleSwitcher`-agnostic hook if useful.
- Build/typecheck wired into root `typecheck` script.

**Catalog shape (ICU, namespaced):** one JSON per locale per namespace, e.g.
`messages/en/jobs.json`, `messages/en/offer.json`. Keys hierarchical and semantic:
`offer.acceptCta`, `jobs.empty.title`, `errors.network`. **Never** key by English text.

## 2. Per-app wiring (Codex, repeat for each app)
For each of `intake-web`, `technician-web`, `provider-web`, `ops-web`:
1. Install next-intl; add the `NextIntlClientProvider` at the app root layout, locale resolved
   server-side.
2. App-local catalogs under `src/messages/{en,es}/*.json` (app-specific namespaces).
3. Replace **every** user-facing string with `t('namespace.key')` — includes button labels,
   headings, body copy, placeholders, `aria-label`, `alt`, toasts, validation/error text, empty
   states, and PWA `manifest`/metadata `lang` where applicable.
4. Replace hardcoded date/number/currency formatting with `useFormatter` from `@cluexp/i18n`.
5. Add a **Language switcher**: in `console-ui` Topbar for ops/provider; in the app shell/header
   for intake + technician. Switching sets the `NEXT_LOCALE` cookie and refreshes; persists across
   sessions.

## 2b. Translate by complete workflow (acceptance rule)
A surface ships bilingual only when its **whole user journey** is translated end-to-end — a language
flip mid-task is worse than none. Treat each workflow as the unit of done:
- **Intake:** landing/`o/[slug]` → service select → details → photos → confirm/submit → post-charge
  review. Include every validation message, inline error, and empty/loading state in the flow.
- **Technician:** sign-in → jobs home → incoming offer (countdown) → accept → navigate → arrival PIN
  → in-service → customer approval → complete → earnings/history. Include offer/decline/superseded
  states.
- **Provider / Ops (when their turn comes):** sign-in → board/queue → request drawer → assignment →
  manual "New Request" → docs review. Wrap whole flows even while `es` is deferred.

## 3. Locale routing strategy (⚠️ infra seam — Claude wires, Codex consumes)
- **intake-web (public, SEO):** path-prefix via next-intl middleware, `localePrefix: 'as-needed'`
  → `en` at `/`, `es` at `/es/...`. Emit `<link rel="alternate" hreflang>` for each route. Keep
  the existing `/o/[slug]` per-org intake working under both locales. **Claude owns the middleware
  + rewrites + hreflang + any `vercel.json`/routing implications.**
- **technician-web / provider-web / ops-web (behind auth):** **cookie-based** locale (`NEXT_LOCALE`)
  with `Accept-Language` as first-visit default; no path prefix. Switcher writes the cookie.
- Detection order everywhere: explicit user choice (cookie) → `Accept-Language` → `defaultLocale`.

## 4. Backend coordination (Claude)
- The FastAPI `api/` must stay **locale-neutral**: return **error codes/keys**, not English prose.
  Frontend maps codes → localized messages (`errors.*`). If any user-facing English strings exist
  in `api/store.py` / handlers today, **Codex flags them here; Claude changes the backend** (api is
  infra/Claude's side). Do not hardcode translated strings in the API.

## 4b. Notifications — SMS / email / push are SERVER-SIDE localization (Claude + coordination)
next-intl localizes the **UI only**. Outbound **SMS, email, and push** are generated server-side and
must be localized from the **recipient's stored locale**, not the sender's browser. This needs:
- **A `locale` preference column** on the customer/user identity (and/or per-intake captured locale).
  That's a **schema migration = Claude** (prod DDL is human-gated) — design it now even though OTP/SMS
  (Sprint 4) and push (deferred) aren't live yet, so the field exists when they land.
- **Localized server-side templates** (a small message catalog on the backend keyed by locale), not
  inline English. Frontend `t()` and backend templates stay in sync via the shared glossary.
- **Capture locale at intake** (the customer's chosen UI locale) and persist it with the request, so
  any later notification about that job uses the right language.
This is a coupled workstream: **Codex flags the UI/locale-capture point; Claude owns the column +
templates.** Not blocking the UI i18n, but track it so notifications aren't English-only later.

## 5. Translation workflow + guardrails
- `en` authored inline as strings are externalized. `es` generated (AI) then native-reviewed for the
  intake + technician surfaces before they ship bilingual.
- **Domain glossary first.** Build a reviewed EN→ES glossary of urgent-service / locksmith terms
  (lockout, rekey, deadbolt, dispatch, service call, ETA, technician, fulfillment, overflow…) and
  translate against it for consistency. A **fluent es‑419 speaker reviews** the glossary and the
  shipped intake + technician copy. Machine translation alone will mangle these domain terms.
- Add a **parity check** script (`scripts/i18n-check`): fails if a shipped locale is missing keys
  present in `en`. Wire into CI for `en`+`es` on intake/technician.
- **Font glyphs:** verify the self-hosted Inter / Archivo Narrow woff2 `latin` subset renders
  Spanish accents (`á é í ó ú ñ ¿ ¡`). If any glyph is missing → font asset swap (flag to Claude;
  font/deploy asset = infra).
- **Text expansion:** Spanish runs ~15–30% longer. QA overflow on the **dense consoles** and the
  **mobile technician** screens (buttons, chips, table cells, status badges, the offer countdown).

## 6. Hard contracts (unchanged)
- **No business-logic changes** — presentation only. Trust-state contract
  (`INTAKE|MATCHED|FULFILLMENT`), `console_status` lanes, offer `expires_at`/first-accept-wins, the
  API envelope, and tenancy axes all untouched.
- Keep `typecheck` + `build:ops` + `build:provider` + `build:tech` + intake build **green** at every step.
- No new migrations, no deploys (human-gated). Mock data stays mock.
- **Catalogs = static UI copy ONLY.** Never put DB / customer / user-generated content (names,
  addresses, job notes, org names, free-text, photos) into translation files — that's **data**,
  passed as interpolation values and rendered **as authored** (no auto-translation of user content).
  The lone exception: **enum-like values** (status, service type) get a code→label map in the
  catalog; the stored value stays the code.

## 7. Phasing (so it lands incrementally, each phase shippable)
- **P0 — ESLint enforcement first (prerequisite, see §10):** migrate `next lint` → ESLint CLI + flat
  config with `eslint-config-next` and a `no-literal-string` rule (warn) so new hardcoded UI text is
  flagged from day one. Wire `lint` into CI.
- **P1 — Foundation:** `@cluexp/i18n` + next-intl provider in all 4 apps + switcher + routing seam,
  with `en` only. All builds green. *(Claude wires intake middleware in parallel.)*
- **P2 — Intake bilingual:** externalize + `es` translate + hreflang. Ship.
- **P3 — Technician bilingual:** externalize + `es` translate + overflow QA. Ship.
- **P4 — Provider, then Ops:** externalize to `t()` now (`en`); **defer `es`** until each is
  API-wired/stable, then translate.

## 8. Acceptance / Definition of Done
- All four apps build green with the i18n provider and a working language switcher.
- **Intake + technician** fully EN/ES: switchable, locale persisted, dates/numbers localized, no
  hardcoded user-facing strings remain (scan/lint clean), `es` natively reviewed, no layout overflow.
- **Provider + ops** fully wrapped in `t()` (`en`), switcher present, `es` deferred and tracked.
- i18n parity check passes for shipped locales; backend remains locale-neutral.
- **Complete workflows** translated (§2b) — no half-translated journey on a shipped surface.
- **es‑419 glossary + shipped copy natively reviewed**; no machine-only domain terms.
- **No DB/customer/UGC content in catalogs** (spot-checked); enum→label maps only.
- **ESLint `no-literal-string` active in CI** — new hardcoded UI text is flagged.
- **Notification locale path designed:** a stored `locale` preference exists (or a migration is
  staged) and intake captures the customer's locale, even if SMS/email/push aren't live yet.
- Adding a future locale = adding catalogs only (no code change) — demonstrated by config shape.

## 9. Rough effort (focused work)
Foundation ~2–3d · intake bilingual ~2–3d · technician bilingual ~2–3d · provider+ops wrap ~2–3d ·
QA/translation review ~1–2d. **High-ROI bilingual launch (intake + technician): ~1 week.**
Full four-surface EN/ES: ~1.5–2.5 weeks. (+~0.5–1d for the P0 ESLint migration.)

## 10. ESLint enforcement (P0 prerequisite — powers "new text must use keys")
Today all four apps have a dead `"lint": "next lint"` script (removed in Next 16) and **no ESLint
config** — so nothing enforces key usage. Do this **before** externalizing strings so it guards the
whole effort:
- Migrate each app `next lint` → ESLint CLI via the official codemod
  (`npx @next/codemod@latest next-lint-to-eslint-cli apps/<app>`), producing a flat
  `eslint.config.mjs` + `eslint-config-next`.
- Add a **`no-literal-string`** rule (e.g. `eslint-plugin-i18next` / `eslint-plugin-react` variants),
  starting at **warn** scoped to `src/**` JSX, allow-listing non-UI strings (test ids, keys, class
  names). Goal: flag any new hardcoded user-facing string in PRs.
- Wire `lint` into **CI** (it currently runs only `tsc` + build) so the rule actually gates.
- Don't bulk-fix the backlog the first run surfaces — wrapping strings happens in P1–P4; the rule
  just prevents *new* violations and tracks remaining ones.
