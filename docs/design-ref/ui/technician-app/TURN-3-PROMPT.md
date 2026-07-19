# Turn-3 prompt for Claude Design — gap screens

> Paste the block below into the Claude Design project "ClueXP Technician Dispatch"
> (https://claude.ai/design/p/ec934241-c551-4fb4-a528-18143ce0abc1) as the next message.
> It fills the four gaps found when auditing the mock against
> [`docs/TECHNICIAN-APP-REDESIGN.md`](../../../TECHNICIAN-APP-REDESIGN.md) (§5.1, §8.1–§8.2, §10, §11.4).
> After it renders, re-sync the local copy and extend `DESIGN.md`.

```text
Continue the ClueXP Technician App design — same established system: warm near-black
surfaces, amber #FFBF00 reserved for the single next action, green only for
server-verified truth, red only for danger, amber-hatch for queued-offline, Barlow
Condensed + Source Sans 3, 390×844 one-handed frames, ▸ annotations under each frame.
Turn 3 fills four spec gaps.

GROUP A — EVIDENCE CAPTURE (component "EvidenceCapture"; closeout step 4)
1. Evidence checklist — in-service surface listing required evidence declared at
   Arrived ("2 'before' photos of the unit — 0 of 2", "Photo of any replaced part")
   plus optional additions. Each row: requirement, state (missing / captured /
   uploading % / queued offline / failed — tap to retry / server-received), tap to
   capture. Show the state where required items are missing and REVIEW AND FINISH
   SERVICE is disabled with the reason named.
2. Capture & review — camera-first with gallery fallback, shutter in the thumb zone,
   retake/use controls. After capture: classification is explicit and required —
   customer-safe vs provider-only (never shown to customer) — pre-selected by
   requirement type; optional note where policy requires one.
3. Upload truth states — progress with % and size, failed with retry, queued-offline
   hatched ("sends automatically when you reconnect"), type/size validation error,
   and server-received green confirmation with sync age. No green until the server
   has the file.

GROUP B — BLOCKED WORK MODE (the missing 7th global mode)
4. Work — compliance blocked: mirrors the degraded layout (1h) but harder. Readiness
   cell "Available" shows blocked-red; headline names the exact blocker
   ("LIABILITY INSURANCE EXPIRED JUL 15"); consequence stated ("You won't receive
   offers from any company until this is resolved"); one dominant resolve action
   (UPLOAD NEW DOCUMENT), secondary "Message Sun Valley Plumbing". Going online
   cannot bypass it.
5. Work — suspended: company-suspension vs platform-suspension variants in one frame
   or two. Neutral factual tone — no shame color, red only if permanent. What
   happened, who suspended, what happens next, appeal/contact path, and whether
   other affiliations still dispatch when only one company suspended you.

GROUP C — NOTIFICATION CENTER (Quiet alert class destination)
6. Notification center — where Quiet-class items land: affiliation approved,
   document-expiry reminder, company admin notice. Choose and show the entry point
   (badge on Account tab or a bell in the Work header). List with read/unread,
   per-item deep link, and a named empty state. Annotate: offers, current-job, and
   critical alerts NEVER land only here — they interrupt.
7. Notification preferences — per-class toggles; safety/system classes locked on,
   with consequence-disclosure copy shown when the technician tries to disable one.

GROUP D — PERMISSION PRIMER (component "PermissionPrimer")
8. Moment-of-need education shown BEFORE the OS permission dialog. Two examples:
   camera (at first evidence capture — "photos go only into this job's record") and
   notifications (at first go-online — "offers expire in about 30 seconds; without
   alerts you'll miss them"). Each: why now, exactly what happens if denied, one
   CONTINUE that triggers the OS prompt, an honest "Not now" that names the degraded
   consequence. Include the post-denial repair variant that deep-links to OS
   settings.

Constraints as established: no fabricated data or simulated live states; every async
state carries its truth label (server-verified + age / queued / failed); operational
text ≥14px; primary actions 56–60px in the thumb zone; tabular numerals; recovery
paths never buried.
```
