# ClueXP Localization (i18n) Build Plan — EN/ES, extensible

> **Status:** DRAFT for human review. Not committed, not yet handed to Codex.
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
- **Source of truth:** `en` catalog. `es` = AI first pass + native review.
- 🔑 **Units (distance/ETA):** keep US units (miles) for both locales for now, or localize? Default
  assumption: **keep miles** until told otherwise.

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

## 5. Translation workflow + guardrails
- `en` authored inline as strings are externalized. `es` generated (AI) then native-reviewed for the
  intake + technician surfaces before they ship bilingual.
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

## 7. Phasing (so it lands incrementally, each phase shippable)
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
- Adding a future locale = adding catalogs only (no code change) — demonstrated by config shape.

## 9. Rough effort (focused work)
Foundation ~2–3d · intake bilingual ~2–3d · technician bilingual ~2–3d · provider+ops wrap ~2–3d ·
QA/translation review ~1–2d. **High-ROI bilingual launch (intake + technician): ~1 week.**
Full four-surface EN/ES: ~1.5–2.5 weeks.
