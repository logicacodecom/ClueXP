# Checklist: [FEATURE NAME]

**Artifact Reviewed**: `[spec.md | plan.md | tasks.md | implementation | release]`  
**Reviewer**: `[Codex | Claude Code | Hermes | Other: <name>]` (different agent family from every author)  
**Date**: `[YYYY-MM-DD]`

<!-- For risky changes the reviewer records the verdict in the PR body (authoritative) and may copy it
here for local `--base/--head` checks, as an unfenced block:

```text
## Review Record
Secondary-agent review required: yes
Author agents: <agent>, <agent>
Reviewer agent: <agent>
Review scope: implementation | spec
Reviewed head: <40-character commit SHA>
Review result: approve | changes-requested
Merge owner: <agent>
```
-->

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

## Deploy Safety (merge = deploy; required when adding migrations or config)

- [ ] Starts and serves existing traffic against the currently applied production schema and config.
- [ ] New capabilities default off server-side and fail closed until their migration/env/activation step.
- [ ] Migrations are additive (expand/contract); tests run against the applied production alembic revision (recorded from a read-only query; no secrets).
- [ ] No migration or real send runs during build or startup.
- [ ] Intake and MCP remain compatible with each other's previous revision where a contract changes.
