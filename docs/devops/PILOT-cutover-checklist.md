# PILOT CUTOVER CHECKLIST — first controlled channel

> Fill this in **before** the flip. Nothing flips until the human explicitly approves the selected
> channel. Run discovery SQL in the Supabase **SQL Editor** (server-side). The flip itself is in
> [`PILOT-channel-golive.md`](PILOT-channel-golive.md). Background: [[sprint3-backend-live]],
> [[supabase-prod-migration-path]].

## Hard selection constraints (human directive)
- **Company-branded channel** → `intake_channels.organization_id IS NOT NULL` (NOT a ClueXP platform channel).
- **Owner-only fulfillment** → `intake_channels.fulfillment_policy = 'private'` (DB value). `dispatch.py`
  resolves `'private'` → semantic **`private_owner_only`**: offers go ONLY to the owner org's own
  technicians, never the network. **Must NOT be `'network_open'` or `'network_overflow'`.**
- **One trusted, vetted tenant** → one `organizations` row, `organization_type='company'`, vetted status.
- **One or two approved technicians** linked to that org.
- **Excluded:** ClueXP public intake (`organization_id` null) and `network_open`.
- Supervised live verification; rollback flag ready before flip.

> Fail-closed safety (already in code): a company-owned job with an unset/unknown policy still
> defaults to `private_owner_only`, so it can never leak to the network on a misconfig.

## A. Discovery queries (fill in the blanks)

**A1 — candidate channels (company-branded + owner-only + vetted company):**
```sql
select ic.id as channel_id, ic.slug, ic.display_name, ic.channel_type,
       ic.fulfillment_policy, ic.active, ic.dispatch_cutover_enabled,
       o.id as org_id, o.display_name as company, o.status as org_status
from intake_channels ic
join organizations o on o.id = ic.organization_id        -- excludes ClueXP platform (org_id null)
where ic.active = true
  and ic.fulfillment_policy = 'private'                  -- owner-only; NOT network_open/overflow
order by o.display_name;
```
Pick ONE row. (Confirm the company is genuinely vetted — `select distinct status from organizations;`
to learn the approved value, default is `pending_vetting`.)

**A2 — confirm the tenant + its technicians:**
```sql
select id, display_name, status, organization_type, fulfillment_policy
from organizations where id = '<ORG_ID>';

select t.id, t.display_name, t.status, t.vetting_status, t.is_available, t.skills
from technicians t
join organization_technicians ot on ot.technician_id = t.id
where ot.organization_id = '<ORG_ID>'
order by t.display_name;
```
Pick 1–2 technicians that are vetted/active. (You'll set `is_available=true` at test time.)

## B. Pilot record (complete before the flip)

| # | Item | Value to record | Confirm |
|---|------|-----------------|---------|
| 1 | selected intake_channel | `channel_id=____`, slug=____ | company-branded, active, `fulfillment_policy='private'` |
| 2 | assigned tenant/company | `org_id=____`, name=____ | vetted, `organization_type='company'` |
| 3 | approved technician(s) | `tech_id(s)=____` | active + vetted; will set `is_available=true` |
| 4 | expected dispatch policy | `private_owner_only` | offers go ONLY to this org's technicians |
| 5 | test customer request | controlled/internal customer | created on the pilot channel only |
| 6 | tracking token link | `/t/{token}` | `tracking_token` returned **non-null** on create |
| 7 | technician acceptance | offer → accept | `POST /offers/{offer_id}/accept` by the pilot tech |
| 8 | customer matched tracking | `/t/{token}` shows assignment | tech name/role/ETA visible; `state=matched` |
| 9 | technician status transitions | `en_route→arrived→in_progress→completed_pending_customer` | `PATCH /tickets/{id}/status` (forward-only) |
| 10 | completion_pending_customer | status reached | `customer_actions.can_confirm=true` on token |
| 11 | customer confirmation/review | confirm/review on token link | → `completed_confirmed` (tech endpoint can't do this — 403) |
| 12 | rollback steps | ready before flip | single-channel false + `DISPATCH_CUTOVER_GLOBAL_OFF` available |

## C. Live verification sequence (supervised, after the approved flip)
intake on pilot channel → create returns `tracking_token` (#6) → dispatch offers go **only** to the
pilot org's tech(s) (#4) → tech accepts (#7) → customer `/t/{token}` shows the match (#8) → tech walks
`en_route→arrived→in_progress→completed_pending_customer` (#9, #10) → customer confirms/reviews on the
token link → `completed_confirmed` (#11). Watch Vercel + Supabase logs throughout.

## D. Rollback (instant, two levers)
1. **This channel only:** `update intake_channels set dispatch_cutover_enabled=false where id='<CHANNEL_ID>';`
2. **Global kill-switch:** set `DISPATCH_CUTOVER_GLOBAL_OFF=true` on the Vercel `cluexp-intake` project
   (forces every channel to the legacy stub, no DB edit). In-flight cutover jobs keep their links;
   rollback only affects new intakes.

---
**Nothing flips until the human explicitly approves the selected `channel_id`.**
