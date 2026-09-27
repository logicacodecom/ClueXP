## Summary

- 

## Spec Kit

- Spec directory: 
- `spec.md` updated: no
- `plan.md` updated: no
- `tasks.md` updated: no
- Reviewer checklist updated: no
- Exempt from Spec Kit: no
- If exempt, why: 

## Ownership

- Author agents: 
- Merge owner: 
- Product Owner decision required: no; category: ; evidence: ; target: 
  (only: product scope/risk, production activation, DDL/migrations, out-of-band promotion/rollback,
  real sends or dispatch/payment transactions, domain/secret/platform changes)

<!--
Risky changes (see the constitution) need an independent review from a different agent family.
The REVIEWER adds this block to the PR body (outside any code fence) for the head they reviewed:

```text
## Review Record
Secondary-agent review required: yes
Author agents: Claude Code
Reviewer agent: Codex
Review scope: implementation
Reviewed head: <40-character commit SHA>
Review result: approve
Merge owner: Claude Code
```
-->

## Verification

- [ ] `npm run typecheck`
- [ ] Relevant app build(s)
- [ ] Relevant Python tests
- [ ] Migration/OpenAPI/generated-artifact drift checks if touched
- [ ] Manual acceptance evidence if user-facing

## Safety Gates

- [ ] No secrets, credentials, private customer evidence, or unmasked sensitive operational data committed
- [ ] Tenant isolation and trust-state/API-contract rules preserved
- [ ] Tenant/RLS evidence is linked or marked not applicable
- [ ] Safe to deploy on merge: works against the current production schema/config; new capabilities default off and fail closed; migrations additive (tests against the applied production revision when adding migrations/config)
- [ ] No production DDL, activation, platform/secret change, real send, or dispatch/cancel/payment action without explicit Product Owner authorization

## Notes

- 
