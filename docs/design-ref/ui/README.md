# ClueXP UI Design References

This folder contains visual references only. Do not import generated HTML directly into
production apps.

## Structure

| Path | Purpose |
|---|---|
| `intake-stitch/` | Original Google Stitch customer intake screen references. Each numbered folder contains `screen.png` and `code.html`. |
| `intake-stitch/DESIGN.md` | Original Stitch design-token/style notes. `docs/DESIGN-SYSTEM.md` (the UI Guide) is now the canonical design system. |
| `Dispatch/` | Generated dispatch-console mocks (`*/screen.png`) + `SPEC-REVIEW-FIXLIST.md` + `cluexp/DESIGN.md`. Reference only — the consoles are built in `apps/ops-web` + `apps/provider-web` (spec: `docs/SYSTEM-DESIGN.md` §18.3–§18.4). |
| `../brand/` | Official ClueXP brand assets (logos, brand board). See `docs/DESIGN-SYSTEM.md §1.1`. |
| `archives/` | Raw archived exports, kept for traceability. |

## Rules

- Use `screen.png` files as visual reference.
- Use `code.html` only to inspect spacing or generated markup ideas.
- Follow `docs/DESIGN-SYSTEM.md` (the UI Guide) for current tokens and shared component language.
- Follow the subsystem specs in `docs/SYSTEM-DESIGN.md` §18 (intake / technician / partner / ops)
  when a mock and spec disagree.

