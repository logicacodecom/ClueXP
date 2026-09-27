# Tasks: [FEATURE NAME]

**Spec**: `[link to spec.md]`  
**Plan**: `[link to plan.md]`  
**Owner**: `[Hermes/Codex lead; delegated owners per task]`

## Conventions

- `[P]` means the task can run in parallel in a separate Orca worktree.
- `[H]` means the task requires Human input or authorization before execution.
- `[R]` means independent secondary review by a different agent family is required before merge.

## Tasks

- [ ] T001 [Owner] [Description and files/surfaces]
- [ ] T002 [P] [Owner] [Description and files/surfaces]
- [ ] T003 [H] [Owner] [Human decision or exact authorization needed]
- [ ] T004 [R] Independent review (different agent family): verify implementation, specs, docs, tests, and unresolved risks; record the Review Record at the exact head.

## Verification

- [ ] [Command or manual check]
- [ ] [CI job or branch protection requirement]
- [ ] [Tenant/RLS/privacy evidence when relevant]
- [ ] [OpenAPI/generated-contract/MCP metadata check when relevant]
- [ ] [Human acceptance evidence when applicable]
