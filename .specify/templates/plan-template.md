# Implementation Plan: [FEATURE NAME]

**Spec**: `[link to spec.md]`  
**Branch**: `[feature-branch]`  
**Owner**: `[Codex | Claude | Human | mixed]`  
**Review Mode**: `[direct | Claude review | second-opinion | debate]`

## Technical Approach

[Describe the implementation approach and why it fits the existing ClueXP architecture.]

## Affected Surfaces

- **Frontend**: [apps/packages/pages/components]
- **Backend/API**: [routes, schemas, clients, store methods]
- **Database/storage**: [migrations, RLS, buckets, generated artifacts]
- **Docs/operations**: [runbooks, handoff, platform docs]
- **CI/release**: [tests, workflows, deploy implications]

## Contracts And Invariants

- [API shape, event shape, state transition, auth/scope, tenant isolation, privacy rule]
- [Trust-state and `jobs.status` relationship, or "not applicable"]
- [Provider-managed dispatch boundary, or "not applicable"]
- [Public `/v1`, MCP, or generated contract compatibility, or "not applicable"]

## Verification Plan

- **Unit/integration**: [commands]
- **Type/build**: [commands]
- **Migration/data**: [commands]
- **Tenant/RLS**: [Postgres/RLS tests, store-scope tests, query review, or "not applicable"]
- **Public contract drift**: [OpenAPI, generated types, MCP metadata, or "not applicable"]
- **Manual/browser/mobile**: [scenarios]
- **Security/privacy**: [checks]

## Rollout And Rollback

- **Flags/config**: [feature flags, env vars, DB settings]
- **Production approval needed**: `[yes/no]`
- **Rollback path**: [disable flag, revert, migration rollback, support action]

## Open Questions

- [Question or blocker]
