# ClueXP docs map

This directory separates current operating docs from historical handoff notes and design references. Use `CLUEXP-PLATFORM-PRODUCT-ROADMAP.md` at the repository root as Product Owner authority for Platform direction.

## Current source-of-truth docs

- `EXECUTION-PLAN.md`: current backlog, release gates, sprint status, and operational risks
- `SYSTEM-DESIGN.md`: architecture, database, deployment, API references, invariants, and Architecture Decision Records
- `PUBLIC-API-DEVELOPER-GUIDE.md`: public `/v1` client contract for approved Website, partner, enterprise, and future agent clients
- `API-HOSTNAME-ROLLOUT.md`: live `api.cluexp.com` hostname boundary, release checks, and rollback notes
- `DESIGN-SYSTEM.md`: UI tokens, patterns, and visual guidance
- `PILOT-OPERATIONS.md`: pilot runbook, smoke matrix, cutover, rollback, and operational readiness
- `PRODUCTION-READINESS.md`: production preflight and operational gates
- `PRIVACY-SECURITY-REVIEW.md`: privacy and security review notes
- `SUPABASE-RLS-AUDIT.md`: Row Level Security closure evidence and follow-up checks
- `TECHNICIAN-APP-REDESIGN.md`: technician PWA/native product architecture and rollout gates
- `SCHEDULING-AND-PARTNER-DISPATCH-MVP.md`: scheduling, partnerships, and provider-to-provider dispatch scope
- `JOB-COMMUNICATION-HUB.md`: job messaging and calling contracts
- `AGENT-INTEGRATION-MCP-PLAN.md`: agent/MCP adapter policy over the public `/v1` API

## Reference and implementation notes

- `HANDOFF.md`: multi-agent working log. Treat it as historical context unless a thread says it is open.
- `implementation/`: implementation-status notes for completed or active slices
- `design-ref/`: visual reference material and generated design artifacts. These files are not product authority.
- App-level READMEs under `apps/*/` document how to run individual packages.

## Retired docs

The older combined Website/Platform plan and pre-Sprint-0 gap assessment were archived under `docs/archive/` on 2026-08-25 because the Platform roadmap, `EXECUTION-PLAN.md`, `SYSTEM-DESIGN.md`, `SUPABASE-RLS-AUDIT.md`, and `PUBLIC-API-DEVELOPER-GUIDE.md` now contain their durable Platform decisions and current status. Website-specific scope from the retired combined plan is governed by the separate Website workstream referenced in the Platform roadmap, not by this Platform repository.
