# Checklist: [FEATURE NAME]

**Artifact Reviewed**: `[spec.md | plan.md | tasks.md | implementation | release]`  
**Reviewer**: `[Human | Codex | Claude]`  
**Date**: `[YYYY-MM-DD]`

## Requirements Quality

- [ ] Requirements are testable and observable.
- [ ] Scope and non-goals are explicit.
- [ ] Ambiguities are resolved or listed as Human decisions.

## ClueXP Safety

- [ ] Tenant isolation is preserved.
- [ ] Tenant isolation has test, query-review, or documented non-applicability evidence.
- [ ] Trust-state and privacy gates are named where relevant.
- [ ] Provider-managed dispatch boundaries remain intact; ClueXP does not dispatch unless explicitly approved.
- [ ] Public `/v1`, MCP, generated type, and OpenAPI contracts are updated or explicitly not applicable.
- [ ] Database migrations include RLS/default-deny impact review or are explicitly not applicable.
- [ ] No technician, ETA, tracking, price, payment, or dispatch state is invented by UI or agent code.
- [ ] No production DDL, deployment, platform submission, payment, or dispatch action is authorized by this checklist alone.

## Verification

- [ ] Tests/checks are listed in `plan.md` and mapped to tasks.
- [ ] CI requirements are identified.
- [ ] Manual acceptance evidence is identified for user-facing or production-facing changes.
