# ADR 0004 — Tenancy & intake: neutral dispatch network

- **Status:** Accepted (2026-06-04)
- **Supersedes:** the interim "ClueXP Direct as a first-party provider org" idea
  floated in `HANDOFF-codex.md` (now retired — see Decision 1).
- **Context:** Before Sprint 2 the business positioning was settled. ClueXP is
  **not a locksmith app** and not a single-provider dispatch tool. It is a
  **neutral, multi-tenant dispatch network for urgent services** — *Clue Express +
  Clue Experts; "the trusted dispatch network for urgent services."* Locksmith /
  access is the first vertical, but the architecture must extend to other urgent
  local services (roadside, garage door, towing, emergency glass, plumbing/HVAC
  emergencies, appliance repair). The strategic goal is to become an alternative
  to "search Google for a locksmith near me": a customer submits a request and
  ClueXP routes it to the most appropriate **verified** company or technician —
  **without competing with its partners.**

This ADR records the tenancy + intake decisions (A–G, human-signed 2026-06-04)
that the data model, API, consoles, and sprint plan must follow. It does **not**
schedule the build; scope/sequencing lives in `EXECUTION-PLAN.md`.

## Actors

- **Platform (ClueXP)** — owns the network, matching rules, trust layer, routing,
  billing logic. Represented as a platform entity, **never a fulfillment provider**.
- **Provider organization** — a service company (e.g. Metro Key). Has its own
  private requests, technicians, and private queue; may opt into network overflow.
- **Individual technician** — solo/contractor; may affiliate with one or more orgs,
  or operate independently in the network. A user/profile, **never a fake org**.
- **Customer** — the person needing urgent service.
- **Lead source / intake owner** — who captured the request (≠ fulfiller).
- **Fulfillment owner** — who actually completes the job.

## Decisions

### 1. Neutral network — no "ClueXP Direct" fulfillment this phase
ClueXP does **not** operate a fulfillment arm and does not appear as a service
competitor to partners. All fulfillment is assigned to a **provider organization**
or a **verified individual technician**. Direct-to-ClueXP customer requests use
**ClueXP-managed routing** to network participants — routing, not ClueXP-owned
fulfillment. *Rationale: partner trust is worth more than short-term fulfillment
control; the SaaS-as-supply flywheel breaks if partners fear a platform-competitor.*
This **supersedes** the earlier "ClueXP Direct provider org" modeling shortcut.

### 2. Origin, customer-owner, and fulfillment are three independent axes
Every job independently tracks:
- **Origin** — who brought the demand (`origin_org_id` + `origin_channel`).
- **Customer owner** — who owns the customer relationship (`customer_owner_org_id`).
- **Fulfillment** — who serves it (`fulfillment_org_id` *nullable* +
  `fulfillment_technician_id`).

They may coincide (partner-private job) but must be free to diverge (a demand-only
partner originates but cannot fulfill; a ClueXP-origin job is fulfilled by a partner).
The legacy single `dispatch_owner` (`cluexp|organization`) field is **retired**.

### 3. Customer identity: global resolution, org-scoped ownership *(Decision A)*
A **global person/identity** record (resolved by phone) exists for de-duplication,
safety, and matching — but is **never browsable by tenants**. The **customer
relationship/ownership** is **org-scoped and isolated** (`customer_owner_org_id` +
per-org association rows, RLS-enforced). One partner can never see another partner's
customers. *Global resolution, never global visibility.* This reconciles "global
customer" with "partner data is protected."

### 4. Customer ownership defaults to the origin owner *(Decision E)*
The **origin owner retains the customer**; the **fulfiller earns the job
revenue/fee**; **ClueXP earns the platform fee**. A fulfiller may **not** re-solicit
or poach the customer unless commercial policy explicitly allows
(`no_solicit_required` default true). *Rationale: partners will not release overflow
if fulfillers can steal customers.*

### 5. Two separate fields — control vs overflow *(Decision C)*
Do not conflate them in one enum:
- **`dispatch_mode`** (who *controls* routing): `organization_managed` |
  `cluexp_managed_routing`. (`cluexp_managed_routing` ≠ ClueXP fulfillment.)
- **`fulfillment_policy`** (the *overflow ladder*): `private` | `network_overflow`
  | `network_open`. Set per org and/or per intake channel.

### 6. No bidding / no auction in MVP *(Decision)*
Matching is **deterministic or ranked**, never an auction. Eligibility considers
service vertical, skill, license, insurance, territory, availability, ETA,
verification tier, and trust — not distance alone. A future marketplace/bidding
layer may be reserved in schema (`marketplace_state`, masked-projection rule) but is
**not built**.

### 7. Trusted-channel resolution; browser input is attribution only
Tenancy/authority is conferred **only** by a trusted channel token, verified domain,
or authenticated session — resolved **server-side**. A browser-supplied `org_id` is
**attribution only, never authority** (anti-spoofing). Intake channels are
publishable (partner site, social, GBP, QR, SMS, email, ads, embed; custom domains
later) and resolve to the owning org; attribution (`intake_channel_id`,
`intake_origin`, referrer/UTM) is recorded on creation.

### 8. ClueXP is a platform actor, never a fulfillment org *(Decision D)*
ClueXP is represented as a platform-type entity that may be **origin** and (per
future policy) **customer owner**, but is **never** a `fulfillment_org_id`.

### 9. Job ownership on overflow; merchant-of-record deferred *(Decision F)*
**Ownership rule (locked):**
- When a **provider org** dispatches/overflows its job to another technician, **the
  org remains the owner** (origin + customer owner); the other technician only
  **fulfills** (`fulfillment_technician_id` set; the fulfilling tech's org, if any,
  does *not* become the owner).
- When **ClueXP routes** a direct request to an **independent technician**, that
  **technician is the fulfiller** (`fulfillment_technician_id` set,
  `fulfillment_org_id` null); origin/owner is the ClueXP platform.

**Merchant-of-record / insurance / legal liability (deferred):** the precise
accountable-party + insurance assignment is a **legal follow-up, not a launch
blocker**. The schema only **reserves** a nullable `responsible_organization_id` so
the answer (likely: provider org for its own jobs; ClueXP platform as facilitator/
backstop for independent-tech jobs) can be set later **without a retrofit**. Do not
hardcode a legal answer now.

### 10. Private-by-default tenant isolation
Every job starts **private to its origin's policy**. Cross-tenant exposure
(overflow, network release, award, anonymous-capacity visibility) is **opt-in and
explicit**; **default-deny**. A job must never accidentally leak across tenants.
Anonymous capacity (a network-visible technician/provider) shows only masked data —
service type, coarse area, ETA, skills, verification tier, distance — **never** name,
phone, exact identity, or customer PII; identity is revealed only on assignment.

## Consequences

- **Trust-state contract unchanged** (`INTAKE → MATCHED → FULFILLMENT`): `matched`
  fires only on a named verified `fulfillment_technician_id`; org-accept ≠ matched;
  no customer/tech identity before assignment. This ADR reinforces it.
- **Code/spec corrections required (do before auth, Decision G):** retire
  `dispatch_owner`; reconcile `provider_organization_id` → `fulfillment_org_id`;
  reword SPEC §2.10 (no "ClueXP dispatches directly" / "direct-release" framing);
  re-express mock fixtures (`routing_source:"ClueXP-routed"`, `dispatch_owner:"cluexp"`)
  as Origin=ClueXP / Fulfillment=partner-or-tech; audit console/technician copy to
  the neutral lexicon (Dispatch Network, Provider Organizations, Verified Technicians,
  Service Requests, Network Overflow, Origin/Fulfillment/Customer Owner, Trusted
  Routing, Service Capacity) — remove "ClueXP Direct / our techs / ClueXP MODE /
  direct-release / marketplace bidding."
- **`adr/0003` still holds** (two console surfaces); the **`ops-web` surface is the
  platform operator console**, not a ClueXP fulfillment cockpit.
- **`adr/0002`** (future Clerk-backed identity/session/org context mapped to
  local ClueXP records) is the substrate for org-scoped RBAC: platform admin =
  cross-org; provider admin/dispatcher = own org(s) only.
- **Sequencing (Decision G):** apply the corrections + document updates **first**;
  the auth foundation + `cluexp-api` extraction follow.
- **Reserved-not-built:** `marketplace_state`, bidding tables, settlement/fees,
  custom public-domain channels, full customer app.
