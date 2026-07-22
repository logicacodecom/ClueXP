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

The page should fit inside the existing provider shell. The map and both right-side panels should fill the available viewport height. Avoid exposing harsh native nested scrollbars as the main interaction. If the queue or technician roster overflows, use a polished controlled-list treatment with integrated up/down controls, a subtle scroll area, and a compact `Showing X-Y of N` indicator.

Suggested page structure:

- Top operations bar with clickable metric filters.
- Main workspace below:
  - Dispatch map.
  - Work queue panel.
  - Technician roster panel.
- Full-width focused-operation action bar when a request or job is selected.
- Full-width, one-line skill-code legend below the workspace.

Do not show a large explanatory subtitle such as `Live map, work queue, and technician roster in one screen for scanning, prioritizing, and monitoring dispatch.` The screen's purpose must be obvious from the layout itself. Keep any equivalent context only as accessible description text if needed for screen readers.

## Queue and roster scrolling behavior

The work queue and technician roster may remain vertically scrollable, but the scrolling should feel designed rather than like two cramped browser windows inside the page.

Preferred behavior:

- Keep the current three-panel cockpit: map, work queue, technician roster.
- Let mouse wheel, trackpad, touch, and keyboard scrolling continue to work.
- Visually soften or hide native scrollbars where safe.
- Add integrated up/down controls inside each panel frame using the same visual language as the provider console.
- Show a compact range indicator, for example `Showing 1-4 of 14`.
- Disable the up/down control when already at the beginning or end.
- Keep panel headers fixed within their panels so the dispatcher always knows which list they are controlling.
- Preserve each list's scroll position during polling, timer ticks, filter changes, and assignment actions unless a selected item must be brought into view.

Default list position and priority:

- If no request/job is selected, the work queue should start at the highest-priority actionable work:
  - Critical or SLA-breached requests.
  - Other at-risk requests.
  - Oldest waiting unassigned requests.
  - Active jobs with the longest ongoing time or exception state.
- If no technician is selected, the technician roster should start with the most usable technicians:
  - Available technicians first.
  - Fresh location before stale location.
  - Busy technicians next.
  - Offline or inactive technicians last.
- If a request is selected, the technician roster should start with ranked candidates for that request, with the best available match at the top.
- If an active job is selected, pin or bring the assigned technician into view.

Optional idle auto-scan:

Auto-rotation can be added, but only as a restrained dispatcher-console behavior, not as a carousel gimmick.

Rules:

- Auto-scan only when no request, job, technician, search field, assignment action, drawer, or modal is active.
- Pause immediately on hover, focus, keyboard use, click, scroll, search input, or any selection.
- Resume only after a calm idle period, for example 20-30 seconds without user activity.
- Advance slowly, for example every 8-12 seconds.
- Move one card group at a time, never jump abruptly.
- Do not auto-scroll a panel while the dispatcher is reading, assigning, or investigating an item.
- Show a tiny status hint only if useful, such as `Auto-scan paused` or `Auto-scanning available techs`.

Auto-scan is a Phase 2 polish item. The first implementation should prioritize integrated up/down controls, priority-first ordering, and scroll-position preservation.

## Top operations bar

Show compact metrics that also work as the primary filters. Do not repeat these filters inside the queue or technician panels.

- Work metrics: Unassigned, SLA at Risk, Active Jobs, and All Work.
- Workforce metrics: Available, Busy, Offline, and All Technicians.
- Live/update state and Refresh.

Clicking a work metric filters the work queue. Clicking a workforce metric filters the technician roster. Visually group the two metric sets so simultaneous work and workforce filters do not look contradictory.

Treat this as an operational filter strip rather than a row of oversized dashboard cards. Keep each target large enough to click comfortably, but minimize vertical height so the map and lists retain as much working space as possible. A suitable compact presentation is:

- `WORK — Unassigned 0 · At risk 0 · Active 1 · All 1`
- `WORKFORCE — Available 5 · Busy 0 · Offline 1 · All 6`

The exact responsive layout may wrap, but the Work and Workforce group labels must remain visible. Do not let the active-filter styling compete with critical alerts or the focused-operation selection.

Keep availability counts truthful and separate from location reliability. If technicians have stale or missing location, show a compact workforce-health warning adjacent to the Workforce group, for example `5 location issues`. Clicking it should focus or filter the affected technicians when that behavior is supported.

Move refresh out of the page title area and into the compact operations strip. A suitable treatment is:

`Live · Updated 12:45:21 · Refresh`

Refresh is specific to the operations workspace. Do not move it into the global provider shell header unless the shell already has a standard page-level refresh slot.

Show the active filter in the related panel header with a compact removable label, such as `Requests ×` or `Available ×`. Keep the queue search field. Do not add a second row of tabs or segmented filters inside either panel.

## Map requirements

Keep the map on the left as an operational instrument, not decoration. It should answer four dispatcher questions at a glance:

- Where is the work?
- Who can respond?
- What requires attention?
- How is the company's technician coverage distributed right now?

Do not let the map crowd the work and technician columns. The map should earn its space by making location, coverage, selection, and exception context clearer than the lists alone.

Add a compact map coverage summary when technician location data supports it, for example:

`TECH COVERAGE · 4 of 6 mapped · 3 available · 2 location issues`

This summary should be truthful. If location data is stale or missing, say so. Do not invent coverage areas, service radiuses, or ETA claims without authoritative backend data. If real provider service zones exist, show them as subtle boundaries or shaded areas; otherwise omit zone visualization.

Show different marker types for:

- Unassigned requests.
- Active/current jobs.
- Technicians.

Markers must be distinguishable by more than color. Use shape, icon, label, or border treatment in addition to color.

### Technician map markers

Technician markers should communicate coverage and identity, not just status dots.

Use a compact professional version of a portrait pin:

- Teardrop or map-pin silhouette.
- Circular technician profile image inside the marker when an authorized image URL exists.
- Initials fallback inside the circle when no profile image exists.
- Marker border or pin body colored by technician status:
  - Available: green.
  - Busy: amber.
  - Offline or inactive: gray.
  - Actionable technician problem: red.
- Location freshness shown separately from status:
  - Fresh location: normal marker.
  - Stale location: small clock/GPS warning badge or subtle dashed secondary ring.
  - Very stale location: reduced opacity plus stale badge.
  - Missing location: no fabricated marker; count it in the coverage warning and show it in the roster.

Recommended sizing:

- Normal technician marker: about 36x44 px.
- Selected technician marker: about 44x54 px with a clear halo.
- Profile image/initial circle: about 24-28 px.

Keep the treatment crisp and operational. Avoid thick cartoon borders or oversized avatars that hide the map.

### Request and active-job map markers

Requests and active jobs must not look like technicians. A dispatcher should be able to separate people from work instantly.

Use this marker language:

- Technician: portrait pin.
- New or unassigned request: blue diamond marker with a service icon or `R`.
- Active/current job: violet rounded-square marker with a tool/job icon or `J`.

Request marker behavior:

- Base marker size around 28-32 px.
- Blue body for normal waiting requests.
- Amber outer border for at-risk requests.
- Red outer border for breached or critical requests.
- Selected request gets a larger marker, halo, and higher z-index.
- Show waiting-time chip such as `18m` for at-risk or breached requests. For normal requests, show the chip on hover, keyboard focus, or selection.
- Selected request callout should show operation ID, situation/service type, waiting time, address, and suitable technician count when known.
- When a request is selected, candidate technician markers may show tiny rank badges such as `1`, `2`, and `3` for the best matches.

Active-job marker behavior:

- Base marker size around 28-32 px.
- Violet body for normal active jobs.
- Amber outer border for overdue confirmation, long-running service, or stale assigned-technician location.
- Red outer border for disputed, severely delayed, or blocked jobs requiring urgent action.
- Show ongoing-time chip for long-running jobs or exception states. Otherwise show it on hover, keyboard focus, or selection.
- Selected active-job callout should show operation ID, current status, ongoing time, assigned technician, and the specific exception if one exists.
- Selecting an active job should highlight the assigned technician portrait pin and draw the supported relationship indicator.

Cluster markers by type:

- Request clusters should keep the blue diamond language.
- Active-job clusters should keep the violet square language.
- Technician clusters should use a people/coverage treatment and may summarize available/busy/offline counts.
- Do not merge people and work into one generic cluster; mixed clusters make the operation picture harder to read.

Map interactions:

- Selecting a request/job highlights the matching row in the queue.
- Selecting a technician highlights the technician in the roster.
- Selecting an unassigned request focuses its marker and ranks compatible technicians in the roster.
- Selecting an active job should highlight the assigned technician if known.
- Selecting a technician should highlight their current job or service area if known.
- Selecting a queue or roster item should pan or zoom the map without recreating the map instance.
- Selecting a request and technician should highlight both markers and may draw a subtle connecting line.
- Selecting any item should center intelligently without resetting the dispatcher's manual zoom unless the selected marker is outside the visible viewport.
- Selection should bring the matching queue or roster card into view using the polished list controls, without losing the dispatcher's scroll context unnecessarily.

Relationship indicators:

- For a selected request and selected technician, draw a subtle connector only when both locations exist.
- For an active job, connect the job marker to the assigned technician marker when both locations exist.
- If real route or ETA data exists, the connector may become a route. If not, treat it as a relationship line and do not imply it is a drivable path.

Initial viewport and map preservation:

- Initial fit should include actionable work and trustworthy technician locations.
- Exclude ancient offline points from the first fit unless there is no better data.
- Preserve manual viewport during polling, timer ticks, and data refresh.
- Provide compact map controls such as **Fit operations** and **Return to selection** if the existing map control pattern supports them.

Include clustering if there are many markers, using the existing map approach where possible.

The page must still be useful if map data is missing or the map key fails. The queue and technician columns should remain operational.

If the selected request or job has no coordinates, do not leave the dispatcher to infer what the visible technician marker represents. Show an unobtrusive map notice such as `Selected job has no coordinates. Showing the assigned technician's last reported location.` Continue to show any trustworthy technician location without presenting it as the work location.

## Work queue panel

The queue panel should combine current requests and active jobs into one operational work column. Remove the explanatory sentence below the panel heading. Use top metric blocks for filtering instead of local tabs or segmented controls.

Use a compact header such as `Work Queue · 12`, followed by the active-filter label and search field.

If the queue overflows, use the integrated list controls described above instead of relying on an obvious internal scrollbar. The top visible cards should always be the highest operational priority when there is no selected work item.

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

The technician's full display name is operationally critical and must not be reduced to an ambiguous first-name fragment such as `Marcus…`. Prefer a two-line name or move the status badge below or beside it so the full name remains readable. If truncation is unavoidable at an unusually narrow width, expose the complete name on hover, keyboard focus, and to assistive technology.

If the roster overflows, use the integrated list controls described above. With no selected work item, the first visible technicians should be the most usable available technicians. With a request selected, candidate-ranked technicians should occupy the top of the roster.

Use a thin status ring around the profile image:

- Available: green.
- Busy: amber.
- Offline or unavailable: gray.
- Actionable technician problem: red.

Keep a text status label. Do not communicate status through the ring alone. Treat availability and location trust as separate signals. For example, a technician can be `Available` with `Location stale · 11h ago`.

The status ring must represent technician status only. A stale or missing location must not replace a green Available ring with an amber ring. Show location trust separately with amber warning text or a GPS warning icon:

- Green ring + `Available` + amber `Location stale · 4h ago`.
- Amber ring + `Busy` + neutral fresh-location text.
- Gray ring + `Offline` + the last known location time when available.

With no selected work item, order the roster by operational usability rather than alphabetically within a status group:

1. Available technicians with fresh location.
2. Available technicians with stale location.
3. Available technicians with missing location.
4. Busy technicians using the same location-trust ordering.
5. Offline or inactive technicians.
6. Use workload, next availability, and then name as additional tie-breakers only when those values are real.

When a request is selected, candidate suitability ranking overrides this default order. When an active job is selected, keep its assigned technician pinned first even when that technician is stale or offline, and show the warning explicitly.

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
6. Explain the specific exception instead of showing only a generic `Review required` badge. Examples include `Customer confirmation overdue · 45h 37m`, `Technician location stale · 4h`, or `Dispute requires provider response`.
7. Provide an explicit **Review job** or **Resolve issue** action in the focused-operation bar whenever review is required.
8. Open supported job-management actions in an in-page drawer. Do not navigate away or replace the roster. The drawer must retain the selected job, assigned technician, map context, and applicable recovery actions.
9. Use **Close** or **Clear selection** to exit focused-operation mode. Do not label this control **Cancel**, because dispatchers may interpret it as cancelling the customer's job.

### Exiting focused-operation mode

Exit focused-operation mode when the dispatcher presses `Esc`, clicks the selected item again, or chooses **Close** or **Clear selection**. Restore the previous ordering and preserve scroll positions.

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
- Remove the visual explanatory subtitle and move refresh/update state into the compact operations strip.
- Keep the map instance stable and update markers in place.
- Upgrade the map marker system so technicians use portrait pins, requests use blue diamonds, and active jobs use violet squares.
- Add truthful technician coverage/distribution context to the map, including mapped count and location issues.
- Replace unpleasant nested-scroll presentation with integrated up/down list controls, priority-first positioning, and scroll-position preservation.
- Keep the technician status ring independent from location-freshness warnings, preserve full names, and sort available technicians by location trust before name.

Phase 2:

- Complete the inline focused-operation and assignment workflow.
- Rank candidate technicians inside the roster.
- Add the focused-operation action bar and in-page management drawer.
- Add active-job exception detection and explanations.
- Add candidate rank badges and relationship connectors on the map for selected requests, technicians, and active jobs.
- Add a restrained idle auto-scan for overflowing lists only if dispatcher testing confirms that it helps rather than distracts.

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
- Technician status-ring and location-trust independence.
- Technician freshness-aware default ordering and full-name presentation.
- Technician profile fallback and skill-code mapping.
- Queue/map/technician selection synchronization.
- Candidate ranking and focused-operation mode.
- Empty states.
- Partial API failure states.
- Missing coordinates.
- Missing-coordinate map explanation when an assigned technician location remains visible.
- Active-job exception explanation and in-page review action.
- Assignment revalidation, confirmation, success, and failure recovery.
- Filter and scroll-position preservation.

Run the existing relevant checks for the provider app and shared UI package.

## Acceptance criteria

- `/operations` is available in the provider app navigation for dispatcher/provider users.
- The map remains on the left on desktop.
- Work queue and technician roster appear as separate operational columns on the right.
- The queue and technician panels do not repeat explanatory subtitles or local filter rows.
- Compact, visibly labeled Work and Workforce metric groups filter the queue and technician roster and show clear active-filter state without consuming excessive workspace height.
- The visual explanatory subtitle is removed; the workspace relies on layout, labels, and accessible context instead.
- Live/update state and Refresh sit with the operations metric strip rather than consuming title-area height.
- Stale or missing technician locations are summarized separately from technician availability counts.
- The map shows a truthful coverage/distribution summary when technician location data exists.
- Technician map markers use photo/initial portrait pins with status color and separate location-freshness treatment.
- Request map markers use a distinct blue diamond treatment.
- Active-job map markers use a distinct violet square treatment.
- Map clusters preserve type identity instead of combining technicians, requests, and jobs into one generic marker.
- Current requests show waiting time.
- Active jobs show ongoing time when reliable data exists.
- Technicians show status and location freshness.
- Technician cards show an authorized profile image or initials fallback.
- Technician cards preserve the complete display name at normal dispatcher widths.
- Technician cards show no more than three neutral skill codes plus `+N`.
- A neutral, full-width, one-line skill-code legend appears below the workspace.
- Availability and location trust remain separate signals; stale GPS never changes an Available status ring from green to amber.
- Status/risk colors are clear but not visually overwhelming.
- Selecting items synchronizes map, queue, and technician context.
- Selecting any queue or roster item applies a visible selected-marker state and centers intelligently without destroying manual zoom.
- Selected request/technician and active-job/assigned-technician relationships are shown with truthful connectors when both locations exist.
- Selecting a request ranks candidates and enables assignment without leaving `/operations`.
- Selecting an active job highlights its assigned technician, explains operational exceptions, and provides an in-page review or resolution action when required.
- The technician roster remains visible during request and job actions.
- Focused-operation exit controls say **Close** or **Clear selection**, not the ambiguous **Cancel**.
- Work queue and technician roster overflow feels intentional, with integrated controls or an equivalent polished treatment rather than unpleasant nested browser scrollbars.
- With no selection, the work queue starts on the most urgent actionable work and the technician roster starts on the most usable available technicians, ordered by location trust before name.
- Any idle auto-scan pauses immediately on interaction and never moves content during focused assignment or investigation.
- The map does not reset its viewport during polling, timer updates, or selection changes.
- When selected work has no coordinates, the map explicitly distinguishes any visible technician location from the missing work location.
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
