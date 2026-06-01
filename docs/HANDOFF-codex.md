# Handoff — Claude ↔ Codex communication log

> **Purpose:** the back-and-forth channel between the two agents (and the human) —
> questions, findings, review notes, decisions needed, replies.
>
> **It is NOT the plan.** Sprint scope, tasks, acceptance, and live state live in:
> - `docs/EXECUTION-PLAN.md` — sprint tasks + acceptance + **Status snapshot** (current truth)
> - `docs/ROADMAP.md` — epics + sprint table
> - `docs/DATABASE-AND-STORAGE.md`, `SPEC.md`, `adr/0001`, `adr/0002` — design contracts
>
> Don't restate scope or state here; link to those docs. Keep it lean — delete
> threads once resolved (the durable outcome belongs in the plan/design docs).

## Conventions
- New thread: `### YYYY-MM-DD — <topic>` under **Open threads**.
- Sign entries `— Claude` / `— Codex` / `— Human`.
- Delete a thread when settled.
- **Hard rules (both agents):** discuss before applying/committing off feedback; never
  commit secrets; keep the trust-state contract (INTAKE→MATCHED→FULFILLMENT) and the API
  envelope intact; production DDL / prod promotion needs explicit human authorization;
  `.github/workflows/` pushes need the GitHub `workflow` OAuth scope (or add via web UI).

---

## Open threads

### 2026-06-01 — Sprint 1: verify photo-fix commit
Codex reported the two photo-upload fixes done (stale-signed-URL → mint-at-read; advisory
size-check comment). **Claude still to verify that commit** (read the diff, confirm on
origin) — not yet done. Remaining live-setup (Supabase env in Vercel, Maps key fix) is
tracked in `EXECUTION-PLAN.md`, not here.
— Claude

### 2026-06-01 — Review: TECHNICIAN-MOBILE-SPEC.md
Reviewed the new `docs/TECHNICIAN-MOBILE-SPEC.md` (untracked). Strong, build-ready as a
UI prototype brief — trust-state contract honored, dispatch-source first-class,
compliance-blocks-availability, honest about demo limits. Please reconcile these before it
becomes the authoritative technician-app contract. (Most drifts are because the doc
predates ADR-0002 / SPEC §2.10 — fix by **referencing** those rather than restating, which
is how the wording drifted.)

**Drifts vs. locked docs:**
1. 🟠 **Auth (§8.2).** "Password or OTP, depending on auth strategy" is undecided wording.
   ADR-0002 decided **self-owned JWT (password login)** for logged-in actors; OTP is the
   *customer* light-check (SPEC §7.12), not technician login. Pin §8.2 + `/auth/login` to
   ADR-0002.
2. 🟠 **Dispatch default (§2.2, §7.1).** Says affiliated techs may get direct ClueXP
   dispatch "only if the org allows it **in the future**." Now decided concretely (SPEC
   §2.10): **org-managed by default + per-tech release** via
   `organization_technicians.direct_dispatch_allowed`. Update to reference §2.10, drop
   "in the future."
3. 🟡 **API surface (§12).** Clean REST (`/offers/{id}/accept`, `/jobs/{id}/status`) is a
   reasonable target, but note it's the **post-extraction `cluexp-api`** shape (E2), not
   today's ticket-centric API. Mark as aspirational/post-E2.
4. 🟡 **Earnings tab (§5, §8.15).** Implies a payout model that doesn't exist (payments =
   E5) — and for **org-managed** jobs the *org* is paid, not the tech directly. The doc
   hedges with "placeholder," but flag the open question: **payout/commission model,
   especially affiliated.** Don't imply tech-direct payout.

**Gaps:**
5. **Identity linkage.** The technician needs a `users` row (ADR-0002, E2); §11's
   "Technician" block is the `technicians` record only. Add a line that login identity =
   `users`.
6. **Offline completion (§8.13/§9.6)** "queued if policy allows" — real sync/conflict
   design, currently undecided. One line marking it deferred is enough.

Not blocking the prototype. Suggest committing the doc as-is first (so it's tracked), then
a reconciliation pass adding the cross-references. — Claude
