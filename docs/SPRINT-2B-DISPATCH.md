# Sprint 2B — Dispatch Engine v1 (design + status)

> Owner: Claude (backend/infra). Couples to Codex (technician offer-delivery UI). Auth/Clerk
> deferred. Branch: `feat/sprint2b-dispatch` (worktree, off `main`).

## Status (2026-06-06)
- **Schema ready — no migration needed.** `technicians` + `dispatch_offers` already exist in prod
  with all required columns (skills[], service-area lat/lng + radius, rating, is_available,
  vetting_status, provider_type, primary_organization_id, current_lat/lng; offers have
  job_id/technician_id/status/rank/offered_at/responded_at/expires_at/organization_id).
- **5 demo technicians seeded** to prod (idempotent) — mix of affiliate (metro-key) + individual,
  varied skills/areas/availability/rating around the metro-key service area.
- **Deterministic scoring validated on live data** (SQL prototype): for a `home` job near metro-key,
  ranks Marcus #1 (available, home, in-area, 0.70 km, 4.9) → Priya #2 → out-of-area / skill-miss /
  offline correctly demoted. ✅ "Dispatch picks a real seeded technician by rule" is proven.

## Deterministic scoring rule (v1)
Filter: `status='active' AND vetting_status='verified'`. Order:
`is_available DESC, skill_match DESC (job.access_type = any(skills)), in_service_area DESC
(haversine(job, tech.service_area_center) <= service_area_radius_km), dist_km ASC, rating DESC`.
Take top-N (N=3) as offers.

## Endpoint plan — ADDITIVE (do NOT break the live intake flow)
The existing `POST /tickets/{id}/dispatch` is a **stub** (hardcodes `tech_stub_247` → instant
MATCHED) and the **live customer flow depends on it**. So v1 lands additively, then we cut the
frontend over with Codex:
1. `POST /tickets/{id}/offers` — run the engine, create top-N `dispatch_offers`
   (status `offered`, rank, `expires_at = now()+90s`, `organization_id` = tech's primary org). Job
   stays `INTAKE`/unmatched. Returns the ranked offers (anonymized for the customer side).
2. `POST /offers/{offer_id}/accept` — **first-accept-wins, atomic**: `UPDATE jobs SET
   fulfillment_technician_id=?, fulfillment_org_id=?, trust_state='matched' WHERE id=? AND
   fulfillment_technician_id IS NULL` → if 1 row updated, mark this offer `accepted`, others
   `superseded`; else 409 (already taken). Preserves `origin_org_id`/`customer_owner_org_id`.
3. `expires_at` sweep → mark `expired`, advance to next-ranked (poll-based for v1).

## Coordination — Codex (frontend)
- Technician offer-delivery v1: poll `dispatch_offers` for the tech; render the offer + countdown
  from `expires_at`; Accept calls `/offers/{id}/accept` (first-accept-wins is backend-enforced).
- **Contract cutover:** once the offer/accept endpoints are live + smoke-passed, we replace the
  intake demo's instant-match stub with the offer→accept loop **together** (so the live customer
  flow never breaks). Until then, the stub stays.

## Remaining (this slice)
- [ ] Code engine + `/offers` + `/offers/{id}/accept` in `apps/intake-web/api/` (store methods +
      routes), keep py-compile + intake build green.
- [ ] Deploy (PR → main → intake auto-deploy).
- [ ] Prod smoke: create job → `/offers` → top tech = Marcus → `/offers/{id}/accept` →
      job.fulfillment_technician_id set, trust_state=matched, others superseded → clean up.
- [ ] Coordinate the intake-flow cutover with Codex.
