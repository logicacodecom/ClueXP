# Dispatch Console Mocks — Spec Review & Prioritized Fix-List

> **Reviewed:** 2026-06-02
> **Against:** [`docs/ORGANIZATION-DISPATCH-CONSOLE-SPEC.md`](../../../ORGANIZATION-DISPATCH-CONSOLE-SPEC.md)
> **Scope:** the 10 generated screens under `docs/design-ref/ui/Dispatch/`.
> **Rule of precedence:** mocks are visual exploration; where a mock and the spec
> disagree, **the spec wins** (per `cluexp/DESIGN.md` and SPEC §8). This list is for
> regenerating/correcting the mocks — it is not an implementation task.

---

## Coverage summary

All 10 screens prioritized in SPEC §17 / Definition of Done (§15) are present:

| Spec screen | Folder | Mode | Verdict |
|---|---|---|---|
| Live Queue (§8.2) | `live_queue_cluexp_mode` | ClueXP | ✅ strong |
| Job Detail (§8.3) | `job_detail_organization_mode` | Organization | ⚠️ missing content (P1) |
| Technician Assignment (§8.6) | `technician_assignment` | — | ❌ off-domain (P0) |
| Route to Organization (§8.4) | `route_to_organization` | ClueXP | ✅ strong |
| Org Job Intake (§8.5) | `organization_job_intake` | Organization | ✅ good |
| Dispatch Board (§8.7) | `dispatch_board_refined` | — | ❌ trust-state lanes (P0) |
| Map Operations (§8.8) | `map_operations` | — | ❌ tactical/off-domain (P0) |
| Escalation Queue (§8.12) | `escalation_queue` | ClueXP | ✅ good |
| Documents/Compliance (§8.13) | `documents_compliance` | — | ✅ good |
| Audit Log (§8.16) | `audit_log` | — | ⚠️ invented trust states (P1) |

Not generated and **not required** (outside the priority-10): Sign In/Workspace Select
(§8.1), Communications Center (§8.11), Team Dispatch (§8.10), Technician Profile Drawer
(§8.9), Reports (§8.14), Settings (§8.15).

---

## P0 — Spec violations of non-negotiables (fix first)

### P0-1 · Dispatch Board lanes use customer trust-state, not `console_status`
- **Screen:** `dispatch_board_refined`
- **Problem:** Columns are `INTAKE / MATCHED / FULFILLMENT / COMPLETED` — these are the
  customer-facing `Ticket.trust_state` values, not operator lanes.
- **Spec:** §8.7 lanes = *Awaiting assignment, Offer sent, Accepted, En route, Arrived,
  In service, Approval needed, Completed, Escalated*. §3.3 + Principle 5 forbid conflating
  `console_status` with `trust_state`; §7.1 says `console_status` "must never drive
  `trust_state`."
- **Fix:** Relabel lanes to the §8.7 console states. If a trust-state read is desired,
  show it as a per-card chip, never as the board's organizing axis. Keep stalled jobs
  floating to the top (§8.7 rule).

### P0-2 · Technician Assignment is off-domain (HVAC, not emergency access)
- **Screen:** `technician_assignment`
- **Problem:** Shows `Emergency HVAC Repair`, `Global Dynamics Corp`, skill sets
  `Residential / Commercial Elite`, and notes *"Unit 4B main compressor failing… pressure
  check… burning smell."* ClueXP is **emergency access** (lockouts, broken/lost keys).
- **Spec:** §1, §13 demo dataset (Car/Home/Business lockout, broken key). Every other
  screen models this correctly.
- **Fix:** Re-theme to a locksmith/access job. Use a §13 demo job (e.g. Job A — Car
  Lockout, Downtown, candidate Jordan Lee) with access-relevant skills
  (auto/residential/commercial lock, broken-key extraction), not HVAC.

### P0-3 · Map Operations uses tactical + multi-trade language
- **Screen:** `map_operations`
- **Problem:** `DEPLOY ASSET`, `OPERATIVES`, service teams `RECON-ALPHA / ELEC-BETA /
  PLUMB-GAMMA / ROOF-DELTA`. Both theatrical and off-domain (electrical/plumbing/roofing).
- **Spec:** §12 "factual, not dramatic"; §8.12 avoid theatrical/law-enforcement language;
  §1 emergency-access domain.
- **Fix:** Replace with operational copy (e.g. "Assign from Map", "Dispatch", "Technicians
  / Jobs / Alerts" filters). Use access-trade team names. Add the §8.8 content currently
  missing: distinct **job vs technician markers with a legend**, **service-area polygon**,
  and **route/ETA + location-staleness** overlays.

---

## P1 — Definition-of-Done gaps & required content

### P1-1 · Direct-release affiliated technician state is absent
- **Screens:** `technician_assignment`, (and Job Detail / profile where relevant)
- **Problem:** No representation anywhere.
- **Spec:** §3.2, §8.9, **DoD #5** ("Direct-release affiliated technician state is
  represented as future/planned or policy-gated").
- **Fix:** Add a `DIRECT-RELEASE` chip (membership-level, marked future/planned) on
  affiliated technicians eligible for direct ClueXP dispatch.

### P1-2 · Offer-based dispatch & first-accept-wins under-represented
- **Screen:** `technician_assignment`
- **Problem:** Only direct `ASSIGN` + `OVERRIDE BLOCK`. No `Send Offer`, `Hold/Reserve`,
  `View Profile`; no offer delivery states; first-accept-wins not surfaced.
- **Spec:** §8.6 actions; §7.4 delivery states (`sent/seen/accepted/declined/expired/…`);
  §8.6 + DoD #7 ("First-accept-wins is described as backend-enforced"); §7.4 offer
  countdowns based on backend `expires_at`.
- **Fix:** Add `Send Offer` / `Hold` / `View Profile` actions, an offer-status chip, and a
  note that acceptance is backend-enforced first-accept-wins. Show offer countdown sourced
  from `expires_at` (as Org Intake already does).

### P1-3 · Job Detail (org mode) missing required content & actions
- **Screen:** `job_detail_organization_mode`
- **Problem:** No visible **trust-state** chip, no **safety flags**, no access-type/
  situation chips. Action set is `Assign / Message ClueXP / Decline` only.
- **Spec:** §8.3 content (status, access type & situation, safety flags, trust-state,
  dispatch owner, assigned technician); §8.3 actions add Route, Reassign, Cancel, Escalate.
  Demo Job B risk "customer alone at night" (§13) should be visible.
- **Fix:** Add a trust-state chip clearly separated from `console_status`; add safety-flag
  and access-type/situation chips; add the missing actions.

### P1-4 · Audit Log invents trust sub-states
- **Screen:** `audit_log`
- **Problem:** Shows `INTAKE INITIALIZED / INTAKE DEGRADED / INTAKE CRITICAL /
  INTAKE VERIFIED`.
- **Spec:** trust_state vocabulary is only `INTAKE / MATCHED / FULFILLMENT` (§7.1, §3.3).
- **Fix:** Use the three real trust_states for the `TRUST STATE` column. Move severity
  ("critical", "degraded") to a separate escalation/console field, not the trust column.

---

## P2 — Consistency & polish

### P2-1 · Inconsistent wordmark
- **Screens:** Map & Escalation use abbreviated `CXP`; others use `CLUEXP` / `ClueXP`.
- **Spec:** §5 — single sticky top-bar wordmark treatment (amber brand mark + uppercase).
- **Fix:** Standardize the wordmark across all screens.

### P2-2 · Live Queue missing some primary actions / filters
- **Screen:** `live_queue_cluexp_mode`
- **Problem:** Row actions are `Assign / Route / Escalate`; only a generic `FILTER` button.
- **Spec:** §8.2 primary actions also include `Call Customer` / `Call Technician`; filters
  list (source, access type, situation, urgency, area, team, age, trust-state, escalation
  reason).
- **Fix:** Add call actions (e.g. in an overflow menu) and expose the filter facets.
  *Lower priority — current screen is otherwise spec-aligned and dense.*

### P2-3 · Route to Organization — add route-to-team & per-org response time
- **Screen:** `route_to_organization`
- **Spec:** §8.4 content (available teams, historical response time per org) + action
  `Route to Team`.
- **Fix:** Add per-org historical response time and a `Route to Team` affordance.

---

## What's already correct (keep)

- Mode distinction is clear and consistent (DoD #1): `CLUEXP MODE` pill,
  `ORGANIZATION MODE: METRO KEY PARTNERS` banner, `Organization Mode` label.
- Ineligible blockers visible (DoD #6): `BLOCKED BY DOCUMENTS / LICENSE EXPIRED`,
  `INSURANCE EXPIRED / ACTIONS LOCKED`, full compliance matrix.
- Internal notes visually separated (DoD #9): dedicated `INTERNAL ORGANIZATION NOTES`
  panel on Job Detail.
- Routing ≠ matched: Route-to-Org and Org Intake avoid implying acceptance = customer
  match (DoD #10).
- Escalation Queue tone is factual (`GPS Stale`, `No Organization Response`,
  `Customer Safety Concern`) — no law-enforcement language (§8.12).
- Design-system fidelity on Live Queue, Dispatch Board, Job Detail, Route-to-Org:
  near-black + amber primary + blue secondary, text+color status chips, condensed heavy
  type, 4px corners (cluexp/DESIGN.md, SPEC §12).

---

## Suggested fix order

1. **P0-1, P0-2, P0-3** — regenerate Dispatch Board lanes, Technician Assignment (re-theme
   to access domain), and Map Operations (de-tactical + add §8.8 overlays).
2. **P1-1, P1-2** — add direct-release chip + offer-based dispatch to Technician Assignment.
3. **P1-3, P1-4** — Job Detail content/actions; Audit Log trust-state vocabulary.
4. **P2** — wordmark consistency and remaining filter/action/affordance gaps.
