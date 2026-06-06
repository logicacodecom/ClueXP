# ClueXP — Vercel Production-Readiness Pass

You are a DevOps agent preparing this repository for production deployment on Vercel.
Work methodically, make only SAFE changes, and STOP to report anything that needs a human decision.

> **Branch:** run this ONLY on `chore/vercel-readiness` (off `main`). Do NOT run it on a
> feature branch. Stage diffs and report — do NOT commit or push without explicit approval.

## Known finding to fix first — ESLint (do NOT re-diagnose)
All four apps (`intake-web`, `ops-web`, `provider-web`, `technician-web`) use `"lint": "next lint"`
on Next.js `^16.0.7`, and there is **no ESLint config anywhere** in the repo. `next lint` was
**removed in Next 16**, so the scripts are dead. Do NOT "fix" this by adding a directory arg
(`next lint ./src` fails too). The correct fix is the official migration, per app:

```
npx @next/codemod@latest next-lint-to-eslint-cli apps/intake-web
npx @next/codemod@latest next-lint-to-eslint-cli apps/ops-web
npx @next/codemod@latest next-lint-to-eslint-cli apps/provider-web
npx @next/codemod@latest next-lint-to-eslint-cli apps/technician-web
```

The codemod requires a clean tree (it's clean on this branch). After it runs, run each app's
`lint` once to confirm it executes, but **do NOT bulk-fix the lint findings it surfaces** — lint
never ran before, so expect a backlog; surfacing it is enough, fixing it is a separate task.

## Repo facts (do not re-discover from scratch — verify, then build on these)
- Monorepo using npm workspaces: `apps/*`, `packages/console-ui`, `packages/api-client`.
- Multiple deployable Next.js (App Router, TypeScript, Tailwind) apps:
  `@cluexp/intake-web`, `@cluexp/ops-web`, `@cluexp/provider-web`, `@cluexp/technician-web`.
- Auth: Clerk. Data: Supabase (Postgres via transaction pooler :6543, plus service-role Storage signing).
- `apps/intake-web` ALSO ships a Python FastAPI backend as Vercel serverless functions
  (`api/**/*.py`, see `apps/intake-web/vercel.json` rewrite `/api/(.*) -> /api/main`).
- Env contract lives in `.env.example` (root).

## Rules of engagement
- DO NOT change business logic, API contracts, DB schema, or auth flows.
- SAFE fixes only: missing/incorrect build config, type errors that block `build`, lint
  auto-fixes, obviously-broken imports, missing devDependencies, misconfigured `vercel.json`,
  Next config issues, `engines`/Node version pinning.
- Treat anything ambiguous as a MANUAL step — list it, don't guess.
- Never write real secret values. Use placeholders and document them.
- Make atomic, reviewable changes. Do not reformat untouched files.

## Tasks (run in order; report findings after each)

1. **Inspect manifests.** Read root `package.json` and every `apps/*/package.json` and
   `packages/*/package.json`. List each app's `scripts` (esp. `build`, `lint`, `start`),
   declared deps vs. workspace deps, and any missing `build` script.

2. **Node / engines.** Check for an `engines.node` field and `.nvmrc`/`.node-version`.
   Vercel's current default is Node 24 LTS. If apps assume an older Node, flag it; pin
   `engines.node` only if clearly safe.

3. **Install.** Detect the lockfile (`package-lock.json`). Run a clean install
   (`npm ci` if the lockfile is in sync, else `npm install`). Report drift if `npm ci` fails.

4. **Lint + build per app.** For each deployable app run its `lint` then `build`
   (e.g. `npm run build --workspace @cluexp/intake-web`). Also run root `npm run typecheck`.
   Capture failures verbatim. Fix only SAFE build blockers; re-run to confirm green.

5. **Env var audit.** Diff `.env.example` against what the code actually reads
   (`process.env.*` in TS, `os.environ`/`getenv` in the Python `api/`). Produce a table:
   `VAR | used where | client/server | in .env.example? | required for build vs runtime`.
   Call out `NEXT_PUBLIC_*` (browser-exposed) vs server-only (esp. `SUPABASE_SERVICE_ROLE_KEY`,
   `GOOGLE_MAPS_API_KEY`, `DATABASE_URL`). Flag any var read in code but absent from `.env.example`,
   and any secret that risks client exposure.

6. **Supabase client usage.** Locate every Supabase client init. Verify:
   service-role key is used ONLY in server contexts (route handlers / server components / Python),
   never imported into client components; browser uses anon/publishable key + `@supabase/ssr`
   cookie pattern where applicable. Report any leak or misuse — do NOT auto-fix auth/data logic; flag it.

7. **Vercel readiness.** For each app confirm: framework preset is detectable, correct
   root directory, build/output settings, and `vercel.json` validity. Validate
   `apps/intake-web/vercel.json` (Python function config + `/api` rewrite). Note that this is a
   monorepo — each app = a separate Vercel project with its own Root Directory. Flag anything
   that won't deploy as-is (e.g. missing `build` script, wrong install command, Python runtime expectations).

8. **Clerk + middleware.** Confirm Clerk middleware/provider wiring exists and required Clerk
   env vars are documented. Flag missing keys; do not alter auth flow.

## Output (final summary, required)
- **Changed files:** path + one-line reason for each.
- **Build status:** per app (pass/fail) with key errors fixed.
- **Env vars:** the audit table, with a clear "must set in Vercel before deploy" list.
- **Manual steps remaining:** numbered, each with what + why + suggested action
  (Vercel project setup, secrets to add, monorepo Root Directory per app, Supabase/Clerk config).
- **Risks / things I refused to touch:** anything skipped because it was business logic or ambiguous.
