# Vercel projects — monorepo configuration

ClueXP is one repo (`logicacodecom/ClueXP`) with **four Vercel projects**, one per app, all under
team `logicacode-projects` and all tracking **`main`** as the production branch. Each project is
distinguished by its **Root Directory**, not by branch. Feature branches get preview deploys per
project.

| Project | Domain(s) | Root Directory | Shared deps it rebuilds for |
|---|---|---|---|
| `cluexp-intake` | intake/www/cluexp.com | `apps/intake-web` | (none — standalone; + Python `api/`) |
| `cluexp-ops` | ops.cluexp.com | `apps/ops-web` | `console-ui`, `api-client` |
| `cluexp-provider` | partners.cluexp.com | `apps/provider-web` | `console-ui`, `api-client` |
| `cluexp-technician` | tech.cluexp.com | `apps/technician-web` | `api-client` |

## Dashboard settings (NOT expressible in vercel.json — keep them set per project)
`vercel.json` lives *inside* the Root Directory, so it cannot define the Root Directory. These must
stay set in **Project → Settings → Build and Deployment**:

- **Root Directory** = the app dir (see table). If this is `null`/repo-root, the build runs where
  there is no `build` script and produces an **empty deployment that returns 404 while still showing
  READY** (this exact bug hit `cluexp-technician` on 2026-06-05; fixed by setting Root Directory).
- **"Include files outside of the Root Directory"** = **ON**. Required so the workspace install
  resolves the `@cluexp/*` packages from the monorepo root. With it on, leave Install/Build commands
  **default** (Vercel installs at the workspace root automatically — do **not** set
  `installCommand: "npm install"`, which would install only the app's deps and break `@cluexp/*`).
- **Framework** = Next.js.

## What `vercel.json` codifies (per app, committed)
- `framework: "nextjs"` — pin detection.
- `ignoreCommand` — **skip the build unless this app's own files or the shared packages it depends
  on changed.** Without it, every push to `main` rebuilds all four projects. The command uses
  `git diff --quiet` over repo-root-relative pathspecs (`:/…`); it exits 0 (skip) when nothing in
  those paths changed, non-zero (build) otherwise. On a shallow clone where the previous SHA is
  missing, the diff errors non-zero → it builds (safe default).
- `cluexp-intake` also keeps its Python function config + `/api` rewrite.

## Verifying a deploy
A `READY` state alone is not proof — an empty/misconfigured deploy can be READY and serve 404.
Always curl a real route (e.g. `/jobs`) and expect a 200 with real markup.
