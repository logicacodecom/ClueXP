# Refine the provider dispatcher operations workspace

Use this prompt with Codex or Claude to refine the existing provider dispatcher operations page. The finished workspace must let a dispatcher identify the right technician and assign a request without leaving `/operations`.

## Prompt

You are working in the ClueXP provider app. Refine the professional dispatcher operations workspace inspired by this reference image:

- `docs/design-ref/ui/Dispatch/provider_dispatcher_operations_reference/screen.png`

Use the reference for the overall operational shape only: a dense job/request list, a technician/driver roster, and a large live map visible together for dispatcher scanning. Do not copy the dated visual styling, saturated row blocks, small hard-to-read controls, or legacy status model. Modernize it for the existing ClueXP product.

Important: inspect the existing codebase first and reuse current provider app patterns, shared UI components, APIs, auth assumptions, and styling conventions. Do not invent a separate stack or redesign the whole provider app.

## Product goal

Create a dispatcher page that gives a full live operations picture in one screen:

- Map on the left.
- Work queue column on the right side of the map showing current requests and active/current jobs.
- Technician roster column on the far right showing all technicians and their operational status.
- Clear colors, status labels, waiting time, ongoing time, SLA risk, and assignment context.
- Built for dispatchers who need to scan, prioritize, assign, and monitor work quickly.

The result should feel like a serious operations console: dense, calm, readable, fast to scan, and useful during repeated daily dispatch work.

## Existing repository context

The provider app already has separate map and queue pages:

- `apps/provider-web/src/app/map/page.tsx` renders `FleetMap`.
- `apps/provider-web/src/app/queue/page.tsx` renders `LiveQueue`.
- `apps/provider-web/src/app/frame.tsx` controls provider navigation.
- Shared provider screens live in `packages/console-ui/src/screens/index.tsx`.
- Existing provider APIs include queue, fleet, candidates, and assignment flows.

Reuse or refactor from the existing `FleetMap` and `LiveQueue` behavior rather than starting from a blank page.

## Recommended route

Use the existing page:

- Route: `/operations`
- Navigation label: `Operations`

Keep the existing `/map` and `/queue` pages unchanged. The operations page can eventually replace them after validation.

## Layout

Use a desktop-first layout that gives the decision panels enough room:

- Left: live map, approximately 45-50% width.
- Middle: work queue panel, approximately 27-31% width.
- Far right: technician roster panel, approximately 22-25% width.

The page should fit inside the existing provider shell. The map and both right-side panels should fill the available viewport height. The queue and technician panels should scroll independently.

Suggested page structure:

- Top operations bar with clickable metric filters.
- Main workspace below:
  - Dispatch map.
  - Work queue panel.
  - Technician roster panel.
- Full-width focused-operation action bar when a request or job is selected.
- Full-width, one-line skill-code legend below the workspace.

## Top operations bar

Show compact metrics that also work as the primary filters. Do not repeat these filters inside the queue or technician panels.

- Work metrics: Unassigned, SLA at Risk, Active Jobs, and All Work.
- Workforce metrics: Available, Busy, Offline, and All Technicians.
- Last updated time and Refresh.

Clicking a work metric filters the work queue. Clicking a workforce metric filters the technician roster. Visually group the two metric sets so simultaneous work and workforce filters do not look contradictory.

Show the active filter in the related panel header with a compact removable label, such as `Requests ×` or `Available ×`. Keep the queue search field. Do not add a second row of tabs or segmented filters inside either panel.

## Map requirements

Keep the map on the left as operational context, but do not let it crowd the work and technician columns.

Show different marker types for:

- Unassigned requests.
- Active/current jobs.
- Technicians.

Markers must be distinguishable by more than color. Use shape, icon, label, or border treatment in addition to color.

Map interactions:

- Selecting a request/job highlights the matching row in the queue.
- Selecting a technician highlights the technician in the roster.
- Selecting an unassigned request focuses its marker and ranks compatible technicians in the roster.
- Selecting an active job should highlight the assigned technician if known.
- Selecting a technician should highlight their current job or service area if known.
- Selecting a queue or roster item should pan or zoom the map without recreating the map instance.
- Selecting a request and technician should highlight both markers and may draw a subtle connecting line.

Include clustering if there are many markers, using the existing map approach where possible.

The page must still be useful if map data is missing or the map key fails. The queue and technician columns should remain operational.

## Work queue panel

The queue panel should combine current requests and active jobs into one operational work column. Remove the explanatory sentence below the panel heading. Use top metric blocks for filtering instead of local tabs or segmented controls.

Use a compact header such as `Work Queue · 12`, followed by the active-filter label and search field.

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

## Technician roster panel

Show all technicians with clear operational status. Remove the explanatory sentence below the panel heading. Use top workforce metrics for filtering instead of local tabs.

Suggested groups:

- Available.
- Assigned.
- En route.
- On site.
- Break.
- Offline.

Important: only show statuses that the actual backend data supports. If the current API only supports `free`, `busy`, and `inactive`, start with those and design the component so richer statuses can be added later.

Each technician card should show:

- A 40-44 px circular profile image when an authorized image URL exists.
- Initials as the fallback when no profile image exists.
- Name.
- Current status.
- Current job, if assigned.
- Location freshness, for example "updated 2 min ago" or "stale".
- Up to three neutral skill-code rectangles, plus `+N` for remaining skills.
- Workload indicator, if available.
- Next availability or shift end, only if real data exists.

Use a thin status ring around the profile image:

- Available: green.
- Busy: amber.
- Offline or unavailable: gray.
- Actionable technician problem: red.

Keep a text status label. Do not communicate status through the ring alone. Treat availability and location trust as separate signals. For example, a technician can be `Available` with `Location stale · 11h ago`.

Do not display internal skill identifiers such as `LOCKSMITH.RESIDENTIAL_LOCKOUT`. Map backend skills to stable dispatcher codes such as:

- `RES`: Residential.
- `COM`: Commercial.
- `AUTO`: Automotive.
- `SAFE`: Safe service.
- `LOCK`: Lockout.
- `REKEY`: Rekeying.
- `ACCESS`: Access control.

Use one neutral visual style for all skill codes. Do not assign colors to skills because colors are reserved for operational status and risk.

Show a one-line skill legend across the full workspace width below the map, queue, and roster:

`SKILL CODES  RES Residential · COM Commercial · AUTO Automotive · SAFE Safe Service · REKEY Rekeying · ACCESS Access Control`

Keep the legend outside the map so it does not cover map controls or attribution. If the catalog exceeds one line, show the common codes followed by `All codes…`. On narrow screens, collapse the legend into an expandable row instead of adding horizontal scrolling.

## Time semantics

Be precise with timers.

- Waiting time means `now - request_created_at` for unassigned or pending dispatch requests.
- Ongoing time means `now - active_status_started_at`.
- If the backend does not expose a status transition timestamp, do not pretend `created_at` is ongoing time. Show a fallback label or add a backend field.
- SLA countdown should use existing provider SLA settings if present.
- Client timers can tick locally, but data should refresh on the existing polling rhythm unless the repo already has realtime infrastructure.

## Status and color direction

Use semantic colors carefully:

- Critical/breached: red.
- At risk: amber/orange.
- Waiting/new: blue or neutral with blue accent.
- Active/on job: teal or violet.
- Available technician: green.
- Busy technician: amber.
- Offline/inactive: gray.
- Stale or missing location: amber warning text or icon independent of technician availability.
- Technician blocked by an actionable problem: red.

Do not make the whole interface saturated. Use colors as signal accents, not as the background of every row. Red should mean actionable risk, not just decoration.

## Data and API requirements

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
- Authorized profile image URL, if available.
- Status.
- Availability.
- Current latitude/longitude.
- Location updated time.
- Current job.
- Skills or service categories, if available.
- Contact/phone, only if already allowed by the app.

Preserve tenant boundaries and existing provider authorization. Do not expose cross-tenant data.

## Core interactions

Implement these interactions without navigating away from `/operations`:

- Select a queue item and focus it on the map.
- Select a map marker and focus the related queue or technician row.
- Select a technician and focus them on the map.
- Filter work and technicians through the top metric blocks.
- Show useful empty, loading, partial error, stale location, and missing coordinate states.
- Preserve map position, filters, list scroll positions, and selection context during assignment.

### Selecting an unassigned request

When a dispatcher selects an unassigned request:

1. Highlight and pin the selected request card in view.
2. Pan or zoom the map to the request marker and apply a selected-marker treatment.
3. Reorder the technician roster by dispatch suitability: availability, online state, required skills, current location, estimated time of arrival, distance, and workload.
4. Keep all technicians accessible. Visually de-emphasize incompatible or offline technicians instead of silently removing them.
5. Show assignment context on each candidate card, including estimated time of arrival, distance, location freshness, skill match, and workload when available.
6. Let the dispatcher select a technician from the roster.
7. Highlight the selected request and technician markers. Draw a subtle connecting line when both locations exist.
8. Show a full-width focused-operation action bar above the skill legend:

`REQUEST CX-1048 · Waiting 18m    Jordan Lee · ETA 12m    Cancel    Assign`

9. Keep **Assign** disabled until the dispatcher selects an eligible technician.
10. Revalidate the request and technician before assignment.
11. Show a compact confirmation with the request, technician, estimated time of arrival, and skill match.
12. Submit through the existing assignment API.
13. On success, update the request, technician, metrics, map, and queue in place. Keep the dispatcher on `/operations`.
14. On failure, preserve all context and explain how to recover.

If an offer already exists, show the offered technician and countdown in the action bar. Provide supported actions such as **Recall Offer** or **Select Another Technician**.

### Selecting an active job

When a dispatcher selects an active job:

1. Highlight the job card and focus its map marker.
2. Highlight and pin the assigned technician at the top of the roster.
3. Connect the technician and job markers when both locations exist.
4. Show job status, ongoing time, assigned technician, and location warnings in the focused-operation action bar.
5. Detect active-job exceptions, including unusually long service, overdue customer confirmation, dispute, and stale technician location.
6. Show a clear warning when dispatcher review is required.
7. Open supported job-management actions in an in-page drawer. Do not navigate away or replace the roster.

### Exiting focused-operation mode

Exit focused-operation mode when the dispatcher presses `Esc`, clicks the selected item again, or chooses **Cancel**. Restore the previous ordering and preserve scroll positions.

## Responsive behavior

This is primarily a dispatcher desktop view.

For smaller screens:

- Below around 1280px, allow the map to stack above queue and technician panels.
- Below around 900px, use tabs or segmented views for Map, Work, and Tech.
- Do not remove functionality on smaller screens.

## Accessibility and usability

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

## Suggested implementation shape

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

- Keep the existing `/operations` route and composed data feeds.
- Refine the layout, metric filtering, technician cards, skill codes, full-width legend, and selection synchronization.
- Keep the map instance stable and update markers in place.

Phase 2:

- Complete the inline focused-operation and assignment workflow.
- Rank candidate technicians inside the roster.
- Add the focused-operation action bar and in-page management drawer.
- Add active-job exception detection and explanations.

Phase 3:

- Realtime updates if infrastructure exists.
- Better ETA/route/coverage intelligence.
- Shift, workload, break, and conflict logic.
- Notification and escalation workflows.

## Non-goals for the initial production slice

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
- Technician profile fallback and skill-code mapping.
- Queue/map/technician selection synchronization.
- Candidate ranking and focused-operation mode.
- Empty states.
- Partial API failure states.
- Missing coordinates.
- Assignment revalidation, confirmation, success, and failure recovery.
- Filter and scroll-position preservation.

Run the existing relevant checks for the provider app and shared UI package.

## Acceptance criteria

- `/operations` is available in the provider app navigation for dispatcher/provider users.
- The map remains on the left on desktop.
- Work queue and technician roster appear as separate operational columns on the right.
- The queue and technician panels do not repeat explanatory subtitles or local filter rows.
- Top metric blocks filter the queue and technician roster and show clear active-filter state.
- Current requests show waiting time.
- Active jobs show ongoing time when reliable data exists.
- Technicians show status and location freshness.
- Technician cards show an authorized profile image or initials fallback.
- Technician cards show no more than three neutral skill codes plus `+N`.
- A neutral, full-width, one-line skill-code legend appears below the workspace.
- Availability and location trust remain separate signals.
- Status/risk colors are clear but not visually overwhelming.
- Selecting items synchronizes map, queue, and technician context.
- Selecting a request ranks candidates and enables assignment without leaving `/operations`.
- Selecting an active job highlights its assigned technician and surfaces operational exceptions.
- The technician roster remains visible during request and job actions.
- The map does not reset its viewport during polling, timer updates, or selection changes.
- The page handles loading, empty, partial failure, stale GPS, and missing coordinate states.
- Existing `/map` and `/queue` pages still work.
- No cross-tenant data exposure is introduced.
- Relevant tests/checks pass.

## Open decisions to resolve during implementation

Before coding deeply, inspect the data and answer:

- Which route name should be final: `/operations`, `/dispatch`, or `/control-room`? Default to `/operations`.
- Does `active_status_started_at` exist for the current active/recovery status? If not, show a truthful fallback for that row rather than using `created_at` as ongoing time.
- Are technician statuses richer than `free`, `busy`, and `inactive`? If not, design for richer future statuses but display only real ones.
- Is scheduled work available in the current queue data? If not, omit the Scheduled tab in the initial production slice.
- Which candidate fields are authoritative for estimated time of arrival, distance, skill match, workload, and current availability?
- Does the technician API expose an authorized profile image URL? If not, use initials and do not add image storage in this refinement.
- Which active-job durations and states require dispatcher warnings or escalation?
- Which skill identifiers need dispatcher-facing codes, and who owns that mapping?
- Does the app already have realtime infrastructure? If not, use existing polling patterns.

## Implementation instruction

Refine the existing screen in focused increments. Start with layout and map stability, then technician cards and filtering, followed by focused-operation mode and inline assignment. Keep the change production-oriented and consistent with the provider app. After implementation, summarize the files changed, behavior added, and checks run.
