# Feature Specification: [FEATURE NAME]

**Feature Branch**: `[feature-branch]`  
**Spec Directory**: `specs/[###-feature-slug]`  
**Created**: `[YYYY-MM-DD]`  
**Owner**: `[Human | Codex | Claude | mixed]`  
**Status**: `[draft | clarified | planned | tasks-ready | implemented | accepted]`

## Summary

[Describe the user/business outcome in plain language. Focus on what changes and why.]

## Scope

### In Scope

- [Capability or workflow included]

### Out Of Scope

- [Explicit non-goal or deferred behavior]

## Users And Scenarios

### Primary Scenario

1. Given [context]
2. When [action]
3. Then [observable outcome]

### Edge And Failure Scenarios

- [Unauthorized, unavailable, invalid, conflict, empty, offline, stale, or rollback case]

## Requirements

### Functional Requirements

- **FR-001**: [Testable requirement]

### Non-Functional Requirements

- **NFR-001**: [Performance, accessibility, security, privacy, reliability, or observability requirement]

## Data, API, And Trust Boundaries

- **Data touched**: [tables, models, storage, events, generated types]
- **API contracts**: [routes, schemas, OpenAPI, MCP tools, public/private boundary]
- **Trust-state/privacy rules**: [what must not be exposed or invented]
- **Tenant isolation**: [org/customer/provider/technician scoping rules]
- **Dispatch state**: [jobs.status transitions, offer lifecycle, ownership, confirmation gates, or "not applicable"]
- **Payments/closeout**: [advisory records vs real payment processor behavior, or "not applicable"]
- **External side effects**: [SMS, voice, push, provider/customer action, platform submission, or "none"]

## ClueXP-Specific Checks

- **Trust-state rule**: [How `trust_state` and customer-visible identity/tracking remain honest]
- **Provider-managed dispatch rule**: [Why this does not make ClueXP dispatch unless explicitly approved]
- **Public `/v1`/MCP rule**: [Contract compatibility, scope requirements, OpenAPI drift, or "not applicable"]
- **Migration/RLS rule**: [Migration id, RLS impact, rollback/readiness, or "not applicable"]
- **Generated artifacts**: [schema/generated types/OpenAPI snapshots updated, or "not applicable"]

## Acceptance Criteria

- [ ] [User-visible acceptance criterion]
- [ ] [Test or operational evidence criterion]
- [ ] [Tenant/privacy/security evidence criterion when relevant]
- [ ] [Documentation/update criterion]

## Risks, Assumptions, And Human Decisions

- **Risks**: [Known failure modes]
- **Assumptions**: [What the spec relies on]
- **Human decisions needed**: [Approval, product choice, production authorization, secrets]
