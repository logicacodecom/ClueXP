# Provider Dispatcher Operations Workspace - Implementation Prompt

Use this prompt with Codex or Claude to implement the new provider dispatcher operations page.

## Prompt

You are working in the ClueXP provider app. Build a professional dispatcher operations workspace inspired by this reference image:

- `docs/design-ref/ui/Dispatch/provider_dispatcher_operations_reference/screen.png`

Use the reference for the overall operational shape only: a dense job/request list, a technician/driver roster, and a large live map visible together for dispatcher scanning. Do not copy the dated visual styling, saturated row blocks, small hard-to-read controls, or legacy status model. Modernize it for the existing ClueXP product.

Important: inspect the existing codebase first and reuse current provider app patterns, shared UI components, APIs, auth assumptions, and styling conventions. Do not invent a separate stack or redesign the whole provider app.

## Product Goal

Create a dispatcher page that gives a full live operations picture in one screen:

- Map on the left.
- Work queue column on the right side of the map showing current requests and active/current jobs.
- Technician roster column on the far right showing all technicians and their operational status.
- Clear colors, status labels, waiting time, ongoing time, SLA risk, and assignment context.
- Built for dispatchers who need to scan, prioritize, assign, and monitor work quickly.

The result should feel like a serious operations console: dense, calm, readable, fast to scan, and useful during repeated daily dispatch work.

## Existing Repo Context

The provider app already has separate map and queue pages:

- `apps/provider-web/src/app/map/page.tsx` renders `FleetMap`.
- `apps/provider-web/src/app/queue/page.tsx` renders `LiveQueue`.
- `apps/provider-web/src/app/frame.tsx` controls provider navigation.
- Shared provider screens live in `packages/console-ui/src/screens/index.tsx`.
- Existing provider APIs include queue, fleet, candidates, and assignment flows.

Reuse or refactor from the existing `FleetMap` and `LiveQueue` behavior rather than starting from a blank page.

## Recommended Route

Add a new page first:

- Route: `/operations`
- Navigation label: `Operations`

Keep the existing `/map` and `/queue` pages unchanged for now. The operations page can eventually replace them after validation, but the first implementation should be additive.

## Layout

Desktop-first layout:

- Left: live map, approximately 55-60% width.
- Middle/right: work queue panel, approximately 23-27% width.
- Far right: technician roster panel, approximately 17-20% width.

The page should fit inside the existing provider shell. The map and both right-side panels should fill the available viewport height. The queue and technician panels should scroll independently.

Suggested page structure:

- Top operations bar with key metrics and global filters.
- Main workspace below:
  - Dispatch map.
  - Work queue panel.
  - Technician roster panel.

## Top Operations Bar

Show compact metrics that also work as quick filters:

- Unassigned requests.
- SLA at risk.
- Active jobs.
- Available technicians.
- Delayed or offline technicians.
- Last updated time.

Clicking a metric should filter or focus the map and panels where practical.

## Map Requirements

The map should remain the visual anchor of the page.

Show different marker types for:

- Unassigned requests.
- Active/current jobs.
- Technicians.

Markers must be distinguishable by more than color. Use shape, icon, label, or border treatment in addition to color.

Map interactions:

- Selecting a request/job highlights the matching row in the queue.
- Selecting a technician highlights the technician in the roster.
- Selecting an unassigned request should show or prepare compatible technician candidates if that data is available.
- Selecting an active job should highlight the assigned technician if known.
- Selecting a technician should highlight their current job or service area if known.

Include clustering if there are many markers, using the existing map approach where possible.

The page must still be useful if map data is missing or the map key fails. The queue and technician columns should remain operational.

## Work Queue Panel

The queue panel should combine current requests and active jobs into one operational work column.

Suggested tabs or segmented control:

- Requests
- Active jobs
- Scheduled, only if existing data supports it

Each item should show:

- Job/request identifier.
- Customer or location summary.
- Status.
- Priority or SLA state.
- Waiting time for unassigned/pending requests.
- Ongoing time for active jobs.
- Assigned technician, if any.
- Address or service area.
- Short operational context such as access type, issue type, or service category when available.

Sort order:

- Critical/SLA-breached first.
- At-risk next.
- Oldest waiting requests next.
- Active jobs with longest ongoing time or delay next.

Avoid making the list feel like a colorful spreadsheet. Use neutral cards/rows with narrow semantic accents, badges, and clear status text.

## Technician Roster Panel

Show all technicians with clear operational status.

Suggested groups:

- Available.
- Assigned.
- En route.
- On site.
- Break.
- Offline.

Important: only show statuses that the actual backend data supports. If the current API only supports `free`, `busy`, and `inactive`, start with those and design the component so richer statuses can be added later.

Each technician row should show:

- Name.
- Current status.
- Current job, if assigned.
- Location freshness, for example "updated 2 min ago" or "stale".
- Skill or service category tags, if available.
- Workload indicator, if available.
- Next availability or shift end, only if real data exists.

Technician status should be readable without relying only on color.

## Time Semantics

Be precise with timers.

- Waiting time means `now - request_created_at` for unassigned or pending dispatch requests.
- Ongoing time means `now - active_status_started_at`.
- If the backend does not expose a status transition timestamp, do not pretend `created_at` is ongoing time. Show a fallback label or add a backend field.
- SLA countdown should use existing provider SLA settings if present.
- Client timers can tick locally, but data should refresh on the existing polling rhythm unless the repo already has realtime infrastructure.

## Status And Color Direction

Use semantic colors carefully:

- Critical/breached: red.
- At risk: amber/orange.
- Waiting/new: blue or neutral with blue accent.
- Active/on job: teal or violet.
- Available technician: green.
- Busy technician: blue or purple.
- Offline/inactive/stale: gray.

Do not make the whole interface saturated. Use colors as signal accents, not as the background of every row. Red should mean actionable risk, not just decoration.

## Data And API Requirements

This is a production operations workspace, so the data composition must use the existing provider endpoints without relying on a single partial feed:

- Provider queue endpoint: `/api/provider/queue`.
- Provider active/recoverable jobs endpoint: `/api/provider/jobs`.
- Provider fleet endpoint: `/api/provider/fleet`.
- Candidate endpoint for a selected job/request.
- Assignment endpoint.

If necessary, create a thin client-side composition layer first. A future backend endpoint such as `/api/provider/operations` may be useful, but do not add it unless it clearly reduces duplication or fixes data consistency problems.

Treat the sources as follows:

- `/api/provider/queue` is authoritative for pending-dispatch request details, including dispatch attempts, active offer state, decline context, photos, coordinates, waiting time, and pending-dispatch SLA calculations.
- `/api/provider/jobs` is authoritative for the full active and recoverable job set, including assigned, en route, arrived, in progress, customer-confirmation-pending, and disputed states. It exposes map-ready job coordinates, assigned technician display context, technician location freshness, and `active_status_started_at` for reliable current-status timers when the status has an authoritative lifecycle timestamp.
- `/api/provider/jobs` may also include `pending_dispatch`; combine records by `job.id`. Prefer the queue record for pending-dispatch fields and the jobs record for active/recovery status fields.
- `/api/provider/fleet` is authoritative for technician status, location freshness, roster grouping, and map projection. Do not rely on fleet alone as the complete source of active/recoverable jobs.

Data needed for jobs/requests:

- ID.
- Status.
- Created time.
- Current status start time from `active_status_started_at`, if exposed for the current status.
- Customer/location summary.
- Address.
- Latitude/longitude.
- Assigned technician.
- SLA/risk state.
- Service category or access type, if available.

Data needed for technicians:

- ID.
- Name.
- Status.
- Availability.
- Current latitude/longitude.
- Location updated time.
- Current job.
- Skills or service categories, if available.
- Contact/phone, only if already allowed by the app.

Preserve tenant boundaries and existing provider authorization. Do not expose cross-tenant data.

## Core Interactions

Implement these in the initial production slice:

- Select a queue item and focus it on the map.
- Select a map marker and focus the related queue or technician row.
- Select a technician and focus them on the map.
- Filter by status/risk/availability.
- Show useful empty, loading, partial error, stale location, and missing coordinate states.

Assignment interaction can be phase 2 unless the existing queue assignment flow is easy to reuse safely.

If assignment is included:

- Use the existing candidates and assign APIs.
- Revalidate before assignment.
- Confirm the chosen technician and request.
- Handle failure without losing dispatcher context.

## Responsive Behavior

This is primarily a dispatcher desktop view.

For smaller screens:

- Below around 1280px, allow the map to stack above queue and technician panels.
- Below around 900px, use tabs or segmented views for Map, Work, and Tech.
- Do not remove functionality on smaller screens.

## Accessibility And Usability

Requirements:

- Keyboard navigable queue and technician rows.
- Clear focus states.
- Status text plus icons, not color alone.
- Good contrast for risk/status badges.
- Avoid excessive live announcements; only announce meaningful changes.
- Provide list-based fallback context for map items.
- Keep text compact but readable.

## Performance

The page should handle active operations without feeling heavy.

- Avoid reinitializing the map on every refresh.
- Update markers/data in place where possible.
- Avoid unnecessary polling duplication between queue and fleet data.
- Debounce search/filter inputs.
- Keep list rendering efficient for larger queues.

## Suggested Implementation Shape

Likely files/components:

- `apps/provider-web/src/app/operations/page.tsx`
- Provider navigation update in `apps/provider-web/src/app/frame.tsx` or shared nav config.
- A shared screen component such as `DispatcherOperations` in `packages/console-ui`.
- Smaller components such as:
  - `OperationsSummaryBar`
  - `DispatchMapPanel`
  - `WorkQueuePanel`
  - `TechnicianRosterPanel`
  - `OperationsDetailsDrawer` if needed

Prefer extracting reusable logic from the existing `LiveQueue` and `FleetMap` only when it avoids real duplication. Do not perform a broad unrelated refactor.

## Phasing

Phase 1:

- Add `/operations`.
- Compose queue and fleet data.
- Show map, work queue, technician roster, metrics, filters, timers, selection synchronization, and core loading/error states.

Phase 2:

- Add or reuse assignment workflow.
- Show candidate technicians for selected requests.
- Add detail drawer.
- Improve SLA and delay explanations.

Phase 3:

- Realtime updates if infrastructure exists.
- Better ETA/route/coverage intelligence.
- Shift, workload, break, and conflict logic.
- Notification and escalation workflows.

## Non-Goals For Initial Production Slice

Do not include these in the first implementation unless explicitly requested:

- Full route optimization.
- New dispatch algorithm.
- Chat, phone, or SMS workflow.
- Full mobile parity.
- Replacing provider SLA rules.
- Major backend redesign.
- Major visual redesign of the whole provider app.

## Testing

Add tests proportional to the implementation.

Recommended coverage:

- Time formatting and waiting/ongoing timer derivation.
- Risk/status sorting.
- Technician status mapping.
- Queue/map/technician selection synchronization.
- Empty states.
- Partial API failure states.
- Missing coordinates.
- Assignment flow, if implemented.

Run the existing relevant checks for the provider app and shared UI package.

## Acceptance Criteria

- `/operations` is available in the provider app navigation for dispatcher/provider users.
- The map remains on the left on desktop.
- Work queue and technician roster appear as separate operational columns on the right.
- Current requests show waiting time.
- Active jobs show ongoing time when reliable data exists.
- Technicians show status and location freshness.
- Status/risk colors are clear but not visually overwhelming.
- Selecting items synchronizes map, queue, and technician context.
- The page handles loading, empty, partial failure, stale GPS, and missing coordinate states.
- Existing `/map` and `/queue` pages still work.
- No cross-tenant data exposure is introduced.
- Relevant tests/checks pass.

## Open Decisions To Resolve While Implementing

Before coding deeply, inspect the data and answer:

- Which route name should be final: `/operations`, `/dispatch`, or `/control-room`? Default to `/operations`.
- Does `active_status_started_at` exist for the current active/recovery status? If not, show a truthful fallback for that row rather than using `created_at` as ongoing time.
- Are technician statuses richer than `free`, `busy`, and `inactive`? If not, design for richer future statuses but display only real ones.
- Is scheduled work available in the current queue data? If not, omit the Scheduled tab in the initial production slice.
- Is assignment safe to include in phase 1 using existing APIs, or should it remain phase 2?
- Does the app already have realtime infrastructure? If not, use existing polling patterns.

## Implementation Instruction

Build phase 1 first. Keep the change focused, production-oriented, and consistent with the existing provider app. After implementation, provide a short summary of files changed, behavior added, and checks run.
