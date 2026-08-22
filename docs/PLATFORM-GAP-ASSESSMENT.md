# ClueXP Platform — As-Is Architecture & Gap Assessment

> **Status note, 2026-08-22:** This assessment is a pre-Sprint-0 snapshot. Its RLS/security
> release-blocker findings drove migration `0055_default_deny_rls`, which is now applied to
> production and verified in `docs/SUPABASE-RLS-AUDIT.md` and `docs/HANDOFF.md`. Preserve this
> document as architectural evidence, but use the canonical docs for current production state.

**Prepared by:** Senior Technical Architect review (read-only assessment, no code changes)
**Scope:** ClueXP Platform repository only (`c:\__CODE__\ClueXP\intake`). `cluexp.com` marketing site is confirmed absent from this repo — see §14.
**Compared against:** `docs/CLUEXP_PRODUCT_AND_WEBSITE_BUILD_PLAN.md`
**Method:** direct repository inspection — migrations, route handlers, store implementations, tests, CI config. Documentation was treated as a claim, not evidence; findings below are anchored to code.

---

## 1. Executive Technical Assessment

The platform is materially further along than the roadmap doc's framing ("do not immediately code this entire roadmap") assumes. The team already anticipated the network-dispatch problem: migration `0004_tenancy_and_intake.py` ("ADR-4") split job ownership into three independent axes — `origin_org_id`, `customer_owner_org_id`, `fulfillment_org_id` — specifically so a job is not forced to belong to one organization end-to-end. A `fulfillment_policy` enum (`private` / `network_overflow` / `network_open`) and a nullable `intake_channels.organization_id` (null = "ClueXP platform channel") already model the private-vs-network distinction the roadmap calls "dispatch_scope." This is the single most important finding: **the foundational data model for Part I of the roadmap already exists and is load-bearing in production code**, not merely planned.

What is genuinely missing is everything downstream of that foundation: no acquisition/UTM attribution, no external Agent Gateway, no Trust Score data model beyond raw job/review facts, no real payment processor integration (fields only), and — the most serious release blocker — **RLS was enabled with zero policies on only 5 of ~50+ tables**, and every table added since migration 0006 (i.e. the majority of the schema, including settlements, documents, invites, login attempts, governance events) has no RLS at all and is openly readable/writable via Supabase's PostgREST layer to `anon`/`authenticated` roles. This is already tracked internally (`docs/SUPABASE-RLS-AUDIT.md`, dated 2026-07-21) but unresolved as of head migration `0054`.

The dispatch engine itself (eligibility, ranking, offer/accept/decline, TTL, redispatch-adjacent sweep) is well-factored, has a real test suite (289 tests in `test_dispatch.py`), and is reusable as-is under a network-routing layer — the roadmap's stated preference (§7, "avoid rebuilding a working dispatch engine") is achievable with a thin addition, not a rewrite.

## 2. Current Platform Architecture

Monorepo, npm workspaces + uv (Python). Six frontend apps (`intake-web`, `ops-web`, `provider-web`, `technician-web`, `technician-native`, `console-web`), one FastAPI backend co-located in `apps/intake-web/api` (single 7,857-line `main.py`, no router modularization), one shared Postgres/Supabase database, Alembic migrations in `packages/db/alembic` (54 migrations, no ORM — schema truth lives in raw SQL migration bodies). Shared TS packages (`api-client`, `app-core`, `console-ui`) are thin (types + mocks + a few fetch wrappers); the repo's own README calls `api-client` "the seam for the future `cluexp-api`," i.e. an acknowledged placeholder, not a finished abstraction.

Auth is fully custom: PBKDF2 password hashing, hand-rolled HS256 JWT access tokens, hashed opaque refresh tokens, role checks via `require_any_role`, and org-scoping via `_provider_organization_id(session)` pulled from a session dict rather than a request-supplied org id (correct pattern — prevents a caller from asserting an arbitrary org). Customer-facing routes use a separate, unguessable-token capability model (`/t/{token}/...}`), not the session system. No Supabase Auth SDK is used.

## 3. Current End-to-End Job Flow

```
Customer → POST /tickets (channel-resolved via intake_channels.slug)
         → Ticket validated, log_transition("created")
         → status = pending_dispatch (if channel has dispatch_cutover_enabled)
         → tracking_token issued back to client

Dispatcher/ops → POST /ops/queue/{job_id}/assign  (dispatch is NOT automatic on intake;
                  legacy auto-dispatch endpoints return 410 Gone)
         → dispatch.select_candidates() (policy-aware: private / network_overflow / network_open)
         → dispatch.rank_candidates() (haversine distance + skill + availability + rating)
         → store.create_dispatch_offers() (expires_at = now + OFFER_TTL_SECONDS, default 300s)

Technician → POST /offers/{id}/accept (self-scoped, global cross-org active-job lock,
              supersedes sibling offers, sets fulfillment_org_id from the accepting org)
           → EN_ROUTE → ARRIVED (PIN verification) → IN_PROGRESS → COMPLETED_PENDING
           → COMPLETED_CONFIRMED (customer) or AUTO_CLOSED (sweep, 3-day window)

External cron → GET/POST /cron/dispatch-sweep (bearer-secret protected)
              → expire_stale_offers(), auto_close_pending(), reap_stale_technicians(),
                activate_due_scheduled_jobs(), poll_push_receipts(), evaluate_dispatch_alerts()
              → comment explicitly notes: "cleanup-only — no re-dispatch"
```

**Org → Provider → Technician → Job**: `organization_technicians` is the affiliation join (role, status, `network_release_allowed`); a technician can be `individual` or `affiliate` type with a `primary_organization_id`. A job does not have one owning org — it has three: who originated the demand, who owns the customer relationship, and who fulfills it. Tenant isolation today is enforced at the query layer (each store method filters by `organization_id` pulled from session), not by RLS (see §12 — RLS coverage is minimal and this is a release blocker).

**Does the current implementation assume single-org ownership, or does it already support network-level concepts?** It already supports network-level concepts. This is confirmed, not inferred: `intake_channels.organization_id` is nullable and null explicitly means "ClueXP platform channel" (migration `0004`, line 71); `fulfillment_org_id` is resolved only at offer-accept time, not at job creation; `dispatch.normalize_policy()` defaults to `network_open` when no `customer_owner_org_id` exists.

## 4. As-Is vs Target-State Gap Matrix

| Capability | Status | Existing Implementation | Gap | Recommended Action | Dependencies | Risk | Priority |
|---|---|---|---|---|---|---|---|
| Canonical service-request model | IMPLEMENTED — NEEDS MODIFICATION | `jobs` table with origin/owner/fulfillment axes, `fulfillment_policy`, `tracking_token`, `dispatch_attempts`, `operational_id` (migrations 0001,0004,0009,0010,0038) | No `channel` enum distinguishing partner/cluexp/AI; no acquisition fields at all | Add channel + acquisition columns to `jobs`/new `attribution` table | none | Low | P1 |
| `dispatch_scope` (private vs network) | PRODUCTION-READY (renamed) | `fulfillment_policy` ∈ {private, network_overflow, network_open}, `organizations.dispatch_mode`, `network_release_allowed`, `network_released_at` | Naming differs from roadmap's `dispatch_scope`; no explicit third value for AI-gateway-originated | Document existing enum as the ADR; extend enum only if a real behavioral difference is needed | none | Low | P1 (docs only) |
| Service taxonomy | IMPLEMENTED | `service_categories`, `service_skills`, `organization_capabilities`, `canonical_technician_skills` (0029, 0030, 0037) | Not yet exposed as `list_services` in a stable external contract | Wrap existing tables in a versioned read API | none | Low | P2 |
| Partner private dispatch | PRODUCTION-READY | Full offer/accept/TTL/redispatch-sweep pipeline; `intake_channels` per-org branding; `organization_partnerships` (0051) | Overflow-to-network rule is data-modeled but its actual routing logic under `network_overflow` policy needs verification against `dispatch.py` behavior | Read `dispatch.py:87-118` against §5 requirements before building anything new | none | Low | P1 (verify only) |
| ClueXP network dispatch (routing layer) | PARTIALLY IMPLEMENTED | `select_candidates()` already branches on policy; `network_open` path exists | No explicit provider-level (vs technician-level) eligibility ranking, no audit record of why a provider was excluded/ranked | Add a provider-eligibility layer above existing technician ranking; add an audit-record table | dispatch_scope (done) | Medium | P2 |
| Trust layer | PARTIALLY IMPLEMENTED | `job_reviews`, `rating_summaries`, arrival_verifications, dispatch_attempts, decline_reason — the raw signals mostly exist | No consolidated trust-metrics table/service; no acceptance-reliability or price-integrity computation | Build Phase-A "store raw metrics" service over existing tables — no new capture needed for most signals | none | Medium | P2 |
| ETA/fulfillment intelligence | PARTIALLY IMPLEMENTED | Offer/accept/arrival/completion timestamps exist on `jobs`; `technician_devices`/location tracked | No predicted-ETA capture at acceptance time, no ETA-error computation | Add predicted_eta column + calculation job | none | Low | P3 |
| Pricing & price integrity | PARTIALLY IMPLEMENTED | `price_quote`, `final_charge` jsonb on jobs; `cancellation_fee`/`no_show_fee` fields; `job_closeout_reports`/line items | No price-transition history table; no material-change re-authorization enforcement | Add price_transitions audit table; add re-auth gate in `/tickets/{id}/commit`-adjacent routes | none | Medium | P2 |
| Payment & cancellation | NOT IMPLEMENTED (capture) / PARTIALLY (fields) | `PaymentMethod` schema (processor+token only), `/tickets/{id}/charge` route stub, full internal settlement/payout bookkeeping (0034,0035) | No Stripe/Adyen SDK anywhere; no real charge/capture/refund | Integrate real payment processor — this is the largest true build item in Part I | PCI scope decision | High | P1 |
| Canonical ClueXP API / Agent Gateway | NOT IMPLEMENTED | `api-client` package is types+mocks; each app has its own ad hoc `/api/*` proxy routes | No versioned external API, no scopes/rate limiting/idempotency at the gateway level (idempotency exists per-route, not as a gateway concern) | Build thin canonical API layer over existing FastAPI routes | Auth/scopes design | Medium | FUTURE (Phase 5) |
| Acquisition attribution | NOT IMPLEMENTED | Only `intake_channel` slug (tenant attribution, not marketing attribution) — confirmed via full-repo grep, zero UTM/referrer/campaign hits | Entire Part III is greenfield | Add attribution columns/table at request-creation time | none | Low | P1 (cheap, high future leverage) |
| Partner ad spend integration | FUTURE — DO NOT BUILD YET | none | n/a | n/a | Attribution (above) | — | FUTURE (Phase 6) |
| Provider/network dashboards | PARTIALLY IMPLEMENTED | `provider-web` has financial/CRM/audit views; `ops-web` has queue/reports | No acquisition-source or network-economics views (data doesn't exist yet) | Build after attribution lands | Attribution | Low | P3 |
| Tenant isolation / RLS | NOT IMPLEMENTED (release blocker) | RLS enabled with zero policies on only 5 tables (migrations 0002,0003,0004,0005); every table since migration 0006 has no RLS | 18+ tables confirmed openly exposed via Supabase PostgREST to anon/authenticated roles per `docs/SUPABASE-RLS-AUDIT.md`, likely 30+ now through 0054 | Apply RLS (even default-deny, zero-policy) to every table; verify `postgres`/service role bypass is intentional | none — proposed fix already documented, not executed | **Critical** | **P0** |
| Audit/auditability | PARTIALLY IMPLEMENTED | `events` table (job/ticket lifecycle), `log_transition`, `governance_events` (admin actions), `/provider/audit` route | No unified cross-domain audit log (dispatch decisions, consent, attribution changes not all in one place) | Extend `events`/`governance_events` pattern rather than build new | none | Low | P2 |
| Website ↔ Platform contract | NOT IMPLEMENTED | No public website code here (correct — separate repo); `intake_channels`/`/tickets` API is the closest thing to a stable contract today | No documented/versioned public contract | Formalize existing `/tickets`, `/t/{token}`, `/channels/{slug}` routes as the v1 contract | none | Low | P2 |

## 5. Preserve / Extend / Refactor / Replace

**PRESERVE**
- `dispatch.py` pure functions (`rank_candidates`, `select_candidates`, `normalize_policy`, state machine) — well-tested, already policy-aware.
- The three-axis job ownership model (`origin_org_id`/`customer_owner_org_id`/`fulfillment_org_id`) — this *is* the target architecture's ownership model, already built.
- Offer/accept/TTL/decline pipeline and its 289-test coverage.
- Custom auth (JWT + hashed refresh tokens + session revalidation) — sound design, no need to swap for Supabase Auth.
- Idempotency-key pattern already present on messages/collection/arrival routes.
- `intake_channels` as the partner-branding and dispatch-scope mechanism.

**EXTEND**
- `fulfillment_policy` enum → add attribution/channel fields alongside it rather than replacing it.
- `events`/`governance_events` → extend into the unified auditability the roadmap wants, rather than building a parallel audit system.
- `job_reviews`/`rating_summaries`/`arrival_verifications` → extend into Trust Layer Phase A (aggregate, don't re-capture).
- `api-client` package → grow it into the canonical API client the README already earmarks it to become.

**REFACTOR**
- `main.py` at 7,857 lines with no `APIRouter` modularization — a material constraint on adding the Agent Gateway cleanly (new external-facing routes would compound the file). Split by domain before Phase 5.
- RLS posture — not a rewrite, but every table needs a policy statement; treat as one focused migration sweep, not a redesign.
- `_rate_limit_token_action` is in-process only (explicitly noted as not distributed-safe) — fine at current scale, becomes a real constraint once there's more than one API instance.

**REPLACE**
- Nothing rises to "cannot support the target architecture." The `PaymentMethod` placeholder needs real payment-processor integration, but that's an addition, not a replacement of a working system (none exists to replace).

## 6. Three-Demand-Mode Readiness

- **Private Partner Demand**: production-ready today. `intake_channels.organization_id` set, `fulfillment_policy = private` (org-scoped default), offers only go to org-affiliated technicians. This is the current default path and is exercised by the existing test suite.
- **Network Demand**: partially ready. `intake_channels.organization_id = null` + `fulfillment_policy = network_open` already routes to `dispatch.select_candidates()`'s network branch and resolves `fulfillment_org_id` only at accept time — the mechanism exists. What's missing is a provider-level (not just technician-level) eligibility/ranking pass and the audit trail the roadmap requires (§6 of the roadmap: "explaining why a provider/technician was eligible, excluded, ranked...").
- **Agent/Third-Party Network Demand**: not implemented, correctly deferred (roadmap Phase 5). The existing `/tickets` API is not yet a scoped, rate-limited, versioned external contract — it's an internal API consumed by first-party frontends.

**On the explicit `dispatch_scope` question**: an equivalent already exists (`fulfillment_policy`), so no new column is needed — recommend adopting the existing enum as the canonical `dispatch_scope` field in documentation/ADRs rather than introducing a parallel concept. **On org ownership before provider selection**: already solved by construction — `origin_org_id` can be null (ClueXP-originated), `fulfillment_org_id` is resolved at accept time. No product decision is required here; this is implemented, just undocumented as "done" against the roadmap.

## 7. Network Dispatch Readiness

Eligibility, offer generation, TTL, expiration, and acceptance can all remain intact underneath a network-routing layer — confirmed, because they already operate underneath a policy-aware layer (`dispatch.select_candidates`). The minimum additional layer needed is:

```
Network Request (origin_org_id=null) → Provider Eligibility (NEW: subscribed/active org,
  service capability via organization_capabilities, coverage) → existing rank_candidates()
  scoped to technicians of eligible providers → existing offer/accept engine
```

This is additive to `dispatch.py`, not a rewrite. Redispatch today is cleanup-only (no automatic re-offer on expiry per the cron-sweep comment) — if the roadmap's "redispatch" implies automatic re-offering to the next-ranked candidate on expiry/decline, that's a real gap worth flagging as a product decision (see §16) rather than assuming it should be built silently.

## 8. Agent & Partner Gateway Readiness

- **API boundaries**: currently one FastAPI app, one file, ad hoc route groups by path prefix — functional but not gateway-shaped.
- **Auth**: session/JWT model exists but is not scope-based (roles are coarse: platform_admin/provider_admin/dispatcher/technician). An external agent needs narrower, capability-based scopes.
- **Idempotency**: real pattern exists (`error_code == "idempotency_key_reuse"`) on several routes — reusable pattern, needs to be applied gateway-wide.
- **Rate limiting**: only two narrow, hand-rolled limiters (login attempts, per-token action limiter); no general API rate limiting. Required before any external gateway ships.
- **Audit logging**: `events`/`governance_events` exist; would need a dedicated "agent/external action" audit stream.

**Recommended smallest canonical API** (mapping directly to existing internal capability, not new build):
`list_services` → wraps `service_categories`/`organization_capabilities`. `check_coverage`/`check_availability` → wraps existing geocode + `rank_candidates` dry-run. `get_estimate` → wraps `price-quote` route. `create_service_request` → wraps `/tickets`. `authorize_dispatch` → new explicit-consent gate in front of existing `/ops/queue/{id}/assign`. `get_request_status`/`get_tracking` → wraps `/t/{token}` (needs a non-token, scoped variant for agent use). `cancel_request` → wraps `/t/{token}/cancel`. This confirms the roadmap's own instinct (§2: "expose a stable canonical service API and add channel-specific adapters") is achievable as a thin wrapper, not a parallel implementation.

## 9. Trust Layer Readiness

Underlying data mostly exists: `job_reviews` (rating, tags, comment), `rating_summaries`, `arrival_verifications` (predicted vs actual, via PIN + timestamps), `dispatch_offers.decline_reason`, `jobs.dispatch_attempts`, closeout/settlement records (quoted vs final via `price_quote`/`final_charge` jsonb). Missing: no first-class "cancellation reason taxonomy" separate from job status, no complaint/dispute table (roadmap mentions this; not found in schema), no repeat-customer computation. Recommendation matches roadmap's own Phase A: aggregate what exists into a trust-metrics view before adding new capture. Complaint/dispute is the one real schema gap.

## 10. Attribution & Partner Ad-Spend Readiness

Confirmed via full-repo case-insensitive grep: zero UTM/referrer/campaign/click-id fields anywhere in the codebase — this is genuinely greenfield, not partially built. The only attribution-adjacent concept is `intake_channel` (tenant/org identification, not marketing attribution). Minimum schema addition: an `acquisition` jsonb or dedicated columns on `jobs` (source, medium, campaign, click ids, first/last touch) captured at `POST /tickets` time — cheap to add now, high leverage later, and it's explicitly called out in the roadmap as something to "implement before scaling paid/network acquisition." Recommend doing this early (P1) precisely because it's low-cost today and expensive to backfill later.

## 11. Payment/Pricing Assessment

No real payment capture exists — `PaymentMethod.token` is stored but never charged against a processor SDK; `/tickets/{id}/charge` is a route stub. This is the most significant true build item in Part I of the roadmap (not a refactor — a net-new integration). Internal settlement/payout bookkeeping (provider ↔ ClueXP accounting) is fully built and separate from customer payment capture — don't conflate the two in planning; settlement doesn't need to change to add customer payment capture. `cancellation_fee`/`no_show_fee` fields exist but there's no evidence of enforcement logic collecting them.

## 12. Security/Multi-Tenancy Findings — Critical

**This is a release blocker, independent of any roadmap work.** RLS was enabled with zero policies on 5 tables in migrations 0002–0005 (2026-era baseline), then never extended. Every table added since migration 0006 — roughly 45 of ~54 migrations' worth of tables, including `settlement_payments`, `technician_documents`, `technician_invites`, `login_attempts`, `governance_events`, `auth_refresh_tokens`, `job_messages`, `organization_partnerships` — has no RLS at all. Per the repo's own `docs/SUPABASE-RLS-AUDIT.md` (2026-07-21), these are confirmed openly readable/writable via Supabase's PostgREST auto-API to `anon`/`authenticated` roles, not merely theoretical. The mitigating factor: no frontend app uses the Supabase client directly — the FastAPI backend connects via `DATABASE_URL` as the `postgres` role, so today's actual attack surface is "anyone with a Supabase anon/service key can hit PostgREST directly," not "the app itself leaks data." Still, this must be closed before any network-dispatch or external-agent surface increases exposure. Recommend applying RLS (default-deny, zero-policy is sufficient as a first pass, matching the existing baseline pattern) across all tables in one migration, before Phase 1 work begins.

Secondary finding: `AUTH_SECRET` for JWT signing has a hardcoded dev fallback (`auth.py:23`) — verify this is actually overridden in every deployed environment; a missing env var silently degrades to a known secret rather than failing loudly.

## 13. Test/Regression Assessment

Strong: dispatch/eligibility/offer/accept/TTL (`test_dispatch.py`, 289 tests), idempotency (`test_idempotency.py`, `test_collection_idempotency.py`), notifications, auth refresh. Weak/missing: **no dedicated org-isolation test suite** — isolation assertions are embedded piecemeal inside `test_dispatch.py`/`test_alerts.py`, not systematic; **no payments test file** (nothing to test yet, since no real capture exists); **no customer-lifecycle test file** as a distinct suite. Most critically: **pytest exercises `InMemoryStore` exclusively** — `PostgresStore`'s actual SQL is only checked via `inspect.getsource()` string assertions, never executed against a real database, and CI has no live Postgres service. This means any `store.py` change to `PostgresStore` (which is what runs in production) is unverified by the test suite — a standing risk for every dispatch/schema change, not just this roadmap. Recommend adding a real Postgres-backed test tier before Phase 1, and definitely before Phase 2 (network routing changes to the fulfillment path).

## 14. Website ↔ Platform Integration Contract Recommendation

Confirmed: no marketing-site code in this repo — `cluexp.com` appears only as an env-var default hostname in `console-web`'s API routes. The website repo should integrate through the same canonical contract recommended in §8: `check_coverage`, `get_estimate`, `create_service_request` (wrapping `/tickets`), `get_tracking` (wrapping `/t/{token}`). Do not let the website repo call internal `/provider/*` or `/ops/*` routes directly — those are first-party console routes with coarse role checks, not designed for external/public callers.

## 15. Product Owner Decisions Required

**Question: Should offer expiry trigger automatic re-offer to the next-ranked candidate, or does "redispatch" mean dispatcher-manual re-queue only?**
Why it matters: the current cron sweep is explicitly "cleanup-only — no re-dispatch" (code comment). The roadmap's Part I assumes redispatch/retry is a platform behavior.
Option A: Automatic re-offer on expiry (closer to marketplace-style dispatch).
Option B: Keep manual dispatcher re-queue (current behavior), consistent with "no bidding marketplace" principle.
Technical recommendation: Option B preserves the existing no-bidding design intent and requires zero new code; automatic re-offer is a real feature with real edge cases (starvation, fairness).
Impact: determines whether Phase 2 needs new dispatch logic or just a network-eligibility layer on top of what exists.

**Question: What is the actual boundary between `ops-web` and `console-web`?**
Why it matters: both appear to be internal admin/governance surfaces with overlapping route shapes (approvals, documents, org/technician management) built by different contributors at different times.
Option A: Consolidate into one console app.
Option B: Formalize the split (e.g., ops = dispatch oversight, console = platform-admin/back-office) and document it.
Technical recommendation: don't build new Agent Gateway admin tooling into either until this is resolved — avoids a third overlapping surface.
Impact: affects where future network-operations dashboards (§18 of roadmap) get built.

**Question: Is PCI scope acceptable for direct card capture, or should payment be delegated entirely to a hosted processor flow (e.g., Stripe Elements/Checkout)?**
Why it matters: no processor is integrated yet — this is a from-scratch decision, not a migration.
Option A: Stripe Elements/PaymentIntents (tokenized client-side, minimal PCI scope) — recommended, matches the existing `PaymentMethod.token`-only schema design intent.
Option B: A different processor per partner/provider (more flexible for multi-tenant settlement, more complex).
Technical recommendation: Option A first; the settlement/payout system already built (0034/0035) is processor-agnostic and doesn't need to change either way.
Impact: blocks Part I §9-10 entirely until decided.

**Question: Should RLS enforcement be zero-policy default-deny (matching current pattern on the 5 covered tables) or should real per-role policies be written now?**
Why it matters: zero-policy RLS closes the anon/authenticated PostgREST exposure immediately with minimal engineering; real per-role policies take longer but enable future direct-client Supabase usage (e.g., realtime tracking subscriptions).
Option A: Zero-policy RLS everywhere now (fast, matches existing pattern, closes the hole).
Option B: Design real policies per table now (slower, but avoids a second migration pass later).
Technical recommendation: Option A immediately (P0, days not weeks), Option B incrementally as real client-side Supabase use cases emerge (e.g., if live tracking moves off polling to Supabase Realtime).
Impact: P0 blocker either way — Option A should not wait for Option B's design work.

## 16. Recommended Implementation Sequence

**Phase 0 (this document).** Delivered.

**Phase 0.5 — Security closure (new, not in roadmap, must precede everything else)**
Objective: close the RLS exposure. Reused: existing zero-policy RLS pattern from migrations 0002/0003. DB changes: one migration enabling RLS on all uncovered tables. No backend/API/frontend changes. Tests: verify via Supabase advisor/PostgREST probe that anon access is denied post-migration. Risk: low (mirrors existing pattern; `postgres` role bypass preserves current app behavior). Acceptance: zero tables flagged in a re-run of the RLS audit.

**Phase 1 — Foundation (mostly documentation + cheap additions, not the roadmap's assumed heavy lift)**
Objective: make the existing dispatch-scope model canonical and add attribution capture. Reused: `fulfillment_policy`, `origin_org_id`/`customer_owner_org_id`/`fulfillment_org_id`, `events`/`governance_events`. DB changes: add attribution columns to `jobs` (or a new table); no changes needed to dispatch-scope (already exists). Backend: capture attribution at `POST /tickets`. Tests: add org-isolation as a dedicated test file (consolidating existing scattered assertions) and stand up a real-Postgres CI test tier. Risk: low. Acceptance: every job has origin/ownership/scope (already true) plus attribution captured from day one going forward.

**Phase 2 — Network Demand MVP**
Objective: provider-level eligibility above existing technician ranking, plus an audit record of routing decisions. Reused: `select_candidates`, `rank_candidates`, offer/accept/TTL engine entirely unchanged. DB: new `network_routing_events` audit table. Backend: new eligibility function gating which providers' technicians enter `rank_candidates`. Frontend: minimal — network jobs already flow through existing ops/provider queues. Risk: medium (first real behavioral change to dispatch selection). Acceptance: a `network_open` job can be fulfilled by any eligible provider with a full audit trail, per roadmap Phase 2 exit criterion.

**Phase 3 — Partner Web Distribution.** As roadmapped — largely additive (widget/SDK), no core conflicts found.

**Phase 5 — Agent Gateway MVP (renumbered ahead of Phase 4 for this repo)**
Recommend sequencing the Agent Gateway before the public-website AI/search work (roadmap Phase 4), since Phase 4 lives in the other repo and has no dependency on this one finishing first — the gateway is the higher-leverage, same-repo item. Objective: thin canonical API wrapping existing routes (per §8), with real scopes/rate-limiting/idempotency at the boundary. Reused: nearly everything — this is adapter work, not new business logic. Risk: medium (new external trust boundary — needs the `main.py` router split from §5 first).

**Phase 6 — Attribution & Partner Ad Spend, Phase 7 — Trust/Dispatch Intelligence, Phase 8 — Multi-Vertical**: as roadmapped, no repo-specific resequencing needed — these are correctly sequenced last and depend on data volume, not engineering readiness.

## 17. Recommended First Development Sprint

1. **RLS closure migration** (Phase 0.5) — single migration, all tables, zero-policy default-deny matching existing pattern. Highest priority, lowest engineering cost, already fully specified in `docs/SUPABASE-RLS-AUDIT.md`.
2. **Verify `AUTH_SECRET` is set in every deployed environment** (not just documented) — one-line check, closes a silent-fallback risk.
3. **Real-Postgres CI test tier** — add a Postgres service container to `.github/workflows/ci.yml` and convert at least the `PostgresStore` source-inspection tests into real executed tests. Protects every subsequent phase.
4. **Attribution columns on `jobs`** + capture at `POST /tickets` — cheap now, expensive to backfill, unlocks Phase 6 later.
5. **Document ADR-4's ownership model and `fulfillment_policy` as the canonical `dispatch_scope` answer** — closes the roadmap's open question in §6 with "already implemented," preventing duplicate work.
6. **Consolidated org-isolation test file** — extract and formalize the scattered isolation assertions currently embedded in `test_dispatch.py`/`test_alerts.py`.

None of the above touches production behavior except the RLS migration, which closes an existing vulnerability rather than changing intended behavior. This sprint deliberately contains no new product features — it converts what's already built into a documented, secured, and tested foundation before Phase 2 (network dispatch) begins.
