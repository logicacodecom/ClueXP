# ClueXP Technician App — Approved Visual Design (shared Claude/Codex reference)

> **Source:** Claude Design project "ClueXP Technician Dispatch"
> https://claude.ai/design/p/ec934241-c551-4fb4-a528-18143ce0abc1?file=ClueXP+Technician+App.dc.html
> Local copy: [`ClueXP Technician App.dc.html`](ClueXP%20Technician%20App.dc.html) (open in a browser
> with `support.js` beside it; each screen is a 390×844 phone frame with a `data-screen-label`).
> Last synced 2026-07-19 — includes iteration 2 (`2a`–`2l`) and iteration 3 (`3a`–`3j`, the gap
> screens requested via [`TURN-3-PROMPT.md`](TURN-3-PROMPT.md)). The file renders newest turn first
> (t3 → t2 → t1). **No known design gaps remain against the spec's screen inventory.**
>
> **Governing spec:** [`docs/TECHNICIAN-APP-REDESIGN.md`](../../../TECHNICIAN-APP-REDESIGN.md) — this file
> only records the concrete visual language the mock established. Where mock and spec disagree, the
> spec wins. Target app: `apps/technician-web`.

## 1. Design tokens

| Token | Value | Replaces (current `globals.css`) |
|---|---|---|
| `--background` | `#0E0E0E` | same |
| `--card` (panels) | `#161513` | `#171717` (cool → warm) |
| `--card-strong` (raised/keys) | `#1B1916` / `#242019` | `#202020` |
| `--border` | `#2B2823` (subtle) / `#3A362F` (strong) | `#30302e` |
| `--foreground` | `#F1EDE4` | `#f4f1e8` |
| `--muted` | `#8A8171` (labels) / `#A39C8E` (body-muted) / `#6E6759` (faint) | `#a49f94` |
| `--primary` amber | `#FFBF00` on `#141210` text | same |
| `--success` green | `#3DBF7A` (tints: bg `#101812`, border `#234634`, text `#8FCBAA`) | `#31d291` |
| `--danger` red | `#E5484D` (tints: bg `#1A1213`, border `#4A2325`, text `#EDD9D9`) | `#ff6b6b` |
| amber-caution tint | bg `#1E1A10`, border `#5C4A14`, text `#D8C48A`/`#EFE4C8` | new |
| disabled amber action | bg `#5C4A14`, text `#A6987B` | new |

Semantic rules (hard constraints, from the spec):
- **Amber = the single current safe action** + verified attention. One dominant amber button per screen.
- **Green = server-verified truth only.** Never for local/optimistic state.
- **Red = danger/destructive/critical only.** Safety is the only red-led surface.
- **Queued/offline = amber hatch**: `repeating-linear-gradient(-45deg,#1E1A10,#1E1A10 6px,#181510 6px,#181510 12px)` + `#5C4A14` border. Never green, never a spinner.
- Status vocabulary (component sheet `1ad`): green dot = server truth · ring-spinner = loading ·
  amber dot = stale · amber hatch = queued locally · red = failed (always "tap to retry").
- Server-confirmed state is always labeled with sync age: `server-verified · 12 s ago` in
  11–12.5px monospace (`ui-monospace`), green `#5F8A73`.

## 2. Typography

| Role | Face | Notes |
|---|---|---|
| Stage titles, timers, amounts, buttons | **Barlow Condensed** 600–700 | Google font; stage titles 30–40px, countdown up to 92px, buttons 19–24px, letter-spacing .02–.08em, UPPERCASE |
| Instructions, data, body | **Source Sans 3** 400/600/700 | operational text ≥14px, body 15–16px |
| Meta/eyebrow/server labels | `ui-monospace` 600 | 11–12px, letter-spacing .1em, e.g. `STAGE 3 OF 5` |

Replaces current Inter + Archivo Narrow. Tabular numerals for countdown/distance/money.

## 3. Component vocabulary (names from spec §11.4, rendered in mock `1ad`)

- **ReadinessBar** — 4 equal cells (Available · Location · Alerts · Online), dot + 14px label,
  `#161513` bar, 1px `#24211D` cell dividers. Degraded cell: red/amber dot, tinted bg, tappable →
  repair surface. Never says "Ready" while any cell fails.
- **StageHeader** — mono eyebrow `STAGE N OF 5` + 5 segment bars (22×4px, amber done / `#2B2823`
  todo) + Barlow Condensed uppercase title 36px.
- **PrimaryStageAction** — 56–60px full-width amber, Barlow Condensed 22–24px, bottom thumb zone.
  Disabled = `#5C4A14`/`#A6987B` with reason text below (`Enabled after 6 digits`).
- **ContextActionRail** — bottom row of 54px cells: MESSAGE · CALL · SAFETY · MORE. Safety always
  red-bordered (`#4A2325`) red text. Report problem lives under MORE (spec: Safety top-level).
- **PIN input** — 50×60px boxes, Barlow Condensed 30px; states: neutral `#3A362F` border, focused
  2px amber + caret, mismatch `#7A3236` border, locked dim + 🔒 with server countdown. Numeric
  keypad 48px keys on `#242019`; field is `autocomplete="one-time-code"` friendly.
- **Offer countdown** — huge Barlow Condensed (54–92px) + amber progress bar + mono
  `offer expires · server timer`.
- **Message bubbles** — outbound `#2A2416`/border `#3D3418`; every bubble carries delivery truth:
  `Read` (green) / `Delivered` / `Uploading %` (dashed amber = queued) / `Failed · Tap to retry` (red).
- **OperationalAlert** — 3 tones: caution (amber tint), critical (red tint), confirmed (green tint);
  16px round badge + 13.5px text.
- **Map canvas** — dark `#131417` grid placeholder; GPS chip top-left
  (`GPS ±12 ft · synced 5 s ago`); honest fallback = address as text + OPEN IN MAPS APP ↗ + RETRY.
  Never simulated movement, never fabricated ETA.
- Surfaces use bordered panels + dividers, radius 5–8px. **No** wrapping every element in rounded
  cards, no gradient text, no glassmorphism, no decorative sparklines.

## 4. Screen inventory (anchor ids in the .dc.html)

| Id | Screen | Key content |
|---|---|---|
| 1a | Accepted — ready to depart | map 284px, STAGE 1 OF 5, address `UNLOCKED` badge, company row, START ROUTE, rail |
| 1b | En route | full-bleed map, OPEN IN MAPS APP / RECENTER overlays, `8.4 mi at accept`, CONFIRM ARRIVAL |
| 1c | Arrival PIN | instruction, 6 boxes, attempts + `PIN refreshes every 10 min`, disabled action, recovery chips (Customer unavailable / PIN expired / Wrong address / Safety), keypad |
| 1d–1f | PIN incorrect / expired / locked | calm factual errors; locked = server countdown + dispatcher auto-notified |
| 1g | Work — ready/waiting | ReadinessBar all green, ✓ READY FOR OFFERS + sync age, calm copy ("you can lock your phone"), service area + companies cards, GO OFFLINE, 4-tab nav |
| 1h | Work — degraded | Location cell red, `NOT RECEIVING OFFERS`, named cause, FIX LOCATION ACCESS |
| 1i | Incoming offer | queue chip ("2 more offers waiting — shown after this one"), 92px countdown, company, skill-match chip, Area (no exact address) + coarse Travel cards, amount row (or "Amount pending — set by <company> before closeout"), ACCEPT over DECLINE. No rank shown |
| 1j | Arrived — start service | PIN-verified green chip, customer + access details (unlocked post-PIN), required-evidence checklist, START SERVICE |
| 1k | In service | elapsed timer, job card, Add photo / Add service-part tiles, "receipt is built at closeout — not here", REVIEW AND FINISH SERVICE |
| 1l | Job messages — customer | sheet over dimmed job, Customer/Dispatcher/System tabs, offline-queued banner, delivery-truth bubbles, 48px quick replies, "your number stays private" |
| 1m | System timeline | read-only server event log with timestamps |
| 1n | Safety sheet | red-led; I FEEL UNSAFE — ALERT DISPATCHER, CALL 911, consequences copy, acknowledgement state |
| 1o | Report problem (MORE) | 5 structured reasons, optional detail + photo, consequence copy before submit |
| 1p–1r | Closeout steps 1/5/6 | 7-step wizard, autosave chip, managed presets, collection = "record, not payment", hatched ClueXP-doesn't-pay disclaimer, review receipt with provided-by attribution |
| 1s | Confirmation pending | WAITING FOR CUSTOMER, receipt sent state, Busy status row, NUDGE VIA DISPATCHER |
| 1t | Completed | server-confirmed green, recorded totals, settlement-honesty copy, explicit "Go back online?" (never silent restore) |
| 1u–1ac | Recovery variants | offline-queued, GPS stale, map fallback, cancelled en route, released, conflict, session expired (work preserved), draft restored, confirmation timeout |
| 1ad | Component sheet | all of §3 in one frame |

Iteration 2 additions (same token system — no new colors; turn-1 refinements: context-rail and
bottom-nav labels tightened to 12–12.5px, bottom-nav squares replaced with real SVG icons):

| Id | Screen | Key content |
|---|---|---|
| 2a | Profile | photo, name, `Technician ID CX-40217`, identity-verified chip, phone/email/service-area rows, skills chips, compliance list (license/insurance/background with expiry states), affiliated companies |
| 2b | Profile — edit/verification pending | trust-affecting edits (phone, photo) enter a **pending state** (queued-amber vocabulary), old value stays active until confirmed; identity-linked fields editable only via dispatcher |
| 2c | Settings | after-job availability preference (ask every time / auto-online / stay offline), location permission, offer alerts, language, masked-calls always-on, app lock, location-sharing scope, sign out (with "active jobs and drafts stay on device" copy) |
| 2d | Settings — readiness blocked | mirrors 1h: blocked settings degrade readiness, one dominant fix action at a time ("One fix at a time — location comes next") |
| 2e | Receipt builder — line items (closeout step 2) | item rows show `qty × unit` math and provided-by inline, typed add-item chips (service fee/labor/part/key code/third-party/other), subtotal row |
| 2f | Add item — part detail | name, stepper quantity, unit amount with live `1 × $34.50 = $34.50` math, taxable toggle, provided-by segmented control (technician auto-flags reimbursable + photo required at step 4), required note |
| 2g | Receipt — totals & offline queued submit | subtotal/tax/tip/total, hatched offline banner, submit button becomes `QUEUED — WILL SUBMIT AUTOMATICALLY`; never fails silently |
| 2h | Activity | search + All/Active/Completed/Cancelled filters; active job pinned top linking back to command screen; status colors match global vocabulary (green server-confirmed, amber waiting, red cancelled, gray released); named empty states |
| 2i | Earnings | weekly recorded collections split (you collected / company-billed / tips), "recorded ≠ payout" honesty copy, per-company settlement rows — green only when company backend confirms, amber pending otherwise |
| 2j | Masked call — in progress | callee + job + company context always on screen, `Routed via ClueXP — numbers stay private both ways`, MUTE/SPEAKER/END; ending returns to the active-job stage |
| 2k | Call unavailable | names the two honest causes (weak signal / customer declined), RETRY + MESSAGE INSTEAD pivot (quick replies queue offline) |
| 2l | Offer taken by another technician | server-confirmed race loss, no-blame copy ("doesn't affect your standing — you stay Ready"), `NEXT OFFER — 2 WAITING` surfaces queue immediately |

Iteration 3 — gap screens (minor new shades only: softer red text tones `#E5A0A2`/`#E5C6C6`,
raised surface `#201E1A`, border `#2E2A22`; token table otherwise unchanged):

| Id | Screen | Key content |
|---|---|---|
| 3a | Evidence checklist (closeout step 4) | requirements declared at Arrived, `REQUIRED · 1 OF 3 DONE`, per-row truth state (missing / server-received + sync age), per-company requirement attribution, optional additions; finish-service disabled with reason while required items missing |
| 3b | Capture & review — classify required | camera-first + gallery fallback, thumb-zone shutter, RETAKE/USE, mandatory "Who can see this photo?" — customer-safe (shown on receipt) vs provider-only (never shown to customer), pre-selected by requirement type; optional note |
| 3c | Upload truth states | one vocabulary: uploading % (neutral) / queued-offline hatch / failed + RETRY / server-received green + sync age; type/size validation ("photo under 25 MB — take a picture of the page instead"). No green until the server has the file |
| 3d | Work — compliance blocked | 7th global mode; Available cell itself blocked-red and un-toggleable, named blocker + date, "going online can't override this", UPLOAD NEW DOCUMENT + company message path |
| 3e | Work — suspended | one-company pause vs platform suspension in one frame: reason given, review-by date, which affiliations still dispatch ("you can go online for these now"), upload/contact actions |
| 3f | Notification center | Quiet-class only — "offers and current-job alerts never wait here"; read/unread rows with deep links + timestamps, mark-all-read, named empty state |
| 3g | Notification preferences | four classes; Safety & system locked on ("can't be silenced"); consequence-disclosure dialog on disabling document-expiry reminders (links the 3d Blocked outcome) |
| 3h | Primer — camera | at first evidence capture, over dimmed job screen: why now, exact scope ("never your camera roll"), honest denial consequence ("you won't be able to finish this service"), CONTINUE → OS prompt |
| 3i | Primer — notifications | at first go-online: offers expire ~30 s, honest "GO ONLINE WITHOUT ALERTS" path with named consequence |
| 3j | Primer — post-denial repair | OS can't re-prompt, so: numbered settings steps, OPEN CLUEXP SETTINGS ↗ deep link, "your job and draft stay exactly where they are" |

## 5. Copy tone (reuse verbatim where it fits)

Factual, protective, no blame: "That PIN doesn't match this job. **2 attempts left.**" ·
"Queued — sends automatically when you reconnect" · "Stop driving when safe." · "Leaving an unsafe
job is never penalized." · "This is the record, not a payment." · "You can't complete the job
yourself — that's deliberate, so the record is mutual."

## 6. Implementation mapping (agreed scope for the first pass)

Restyle existing working screens in `apps/technician-web` to this language — keep all current BFF
wiring, polling, and state machine:

| Design | Existing code |
|---|---|
| tokens/fonts | `src/app/globals.css`, `src/app/layout.tsx` |
| 4-tab nav Work·Activity·Earnings·Account (drop dead Map/Messages tabs) | `client-widgets.tsx` `TechnicianBottomNav` |
| ReadinessBar + waiting/degraded (1g/1h) | shell/topbar in `mobile.tsx`, `jobs/page.tsx` |
| Offer decision (1i) + taken-race state (2l, maps to the existing 409 handling) | `live-offers.tsx` (stop rendering `rank`) |
| Command surface 1a/1b/1c/1j/1k + recovery banners | `active-job-workflow.tsx` |
| Closeout/pending/completed (1p–1t styling on current single-form flow; 2e/2f line-item language on the existing `CLOSEOUT_ITEM_TYPES` form) | `active-job-workflow.tsx` collection section |
| Profile (2a) / Settings (2c) | `src/app/profile/page.tsx`, `src/app/settings/page.tsx` |
| Activity (2h) | `src/app/activity/page.tsx` |
| Earnings (2i) | `src/app/earnings/page.tsx` |
| PWA manifest fixes: honest description (drop "mockup"), 192+512 icons with separate `any`/`maskable` purposes, `background_color` `#0E0E0E` | `public/manifest.webmanifest` + icon assets |

**Native-readiness rules for the restyle** (spec §12.1 — build shareable, don't retrofit):

- Design tokens land as semantic CSS variables in one place (`globals.css`), named per §1 of this file —
  the future `packages/technician-design` extracts them verbatim.
- Stage state machine, transition guards, allowed-action derivation, stage copy, and error
  normalization move out of React components into pure TS modules (no React/Next/browser imports)
  inside `apps/technician-web` for now — the future `packages/technician-domain` lifts them
  unchanged. Components render from those modules; they don't own lifecycle logic.
- **No service worker in this pass** — per spec §12.2 it waits for defined cache/mutation safety
  rules (TAR-3+). Absence of offline cache/push is a documented decision, not an oversight.
- Actual package creation (`technician-domain`/`-sync`/`-design`) stays behind the spec §12.1
  repository architecture review — first pass only shapes code so extraction is mechanical.

Not in the first pass (backend unbuilt — per spec, no surface may imply them): job chat (1l/1m),
mediated call (2j/2k), 7-step closeout wizard (TAR-6), pending-verification profile edits (2b),
after-job availability preference + app lock settings (2c), push-driven offer takeover, evidence
capture (3a–3c, needs a job-evidence API — TAR-4), blocked/suspended work modes (3d/3e, need the
TAR-1 readiness/compliance projection), notification center + preferences (3f/3g, TAR-7 push era),
permission primers (3h–3j, land with the features whose permissions they prime). Native keypad PIN
entry can use the system keyboard with `inputmode="numeric"` instead of the custom keypad.

Existing mock chat/call pages (`/jobs/[id]/chat`, `/call`) are misleading demo surfaces slated for
honest removal/redirect (spec TAR-0).
