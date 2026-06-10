# PILOT GO-LIVE RUNBOOK — flip the first cutover channel

> **This is the only step that changes live customer behavior.** Everything before it (migration
> `0010`, the deploy) was inert because flags ship OFF. Flipping a channel routes that channel's
> real customers through the offer → accept → track → fulfill → confirm flow instead of the legacy
> stub. **Requires explicit human authorization each time. Flip exactly ONE low-volume channel
> first.** Apply the SQL in the Supabase **SQL Editor** (server-side; the direct DB host is
> IPv6-only — see [[supabase-prod-migration-path]]).

## Preconditions (all currently TRUE)
- Backend live on `https://cluexp-intake.vercel.app`, migration `0010` applied, all flags OFF.
- Frontend tracking page (`/t/[token]`) deployed and reachable for customers.
- `DISPATCH_CUTOVER_GLOBAL_OFF` is unset/false (the kill-switch is NOT engaged).
- A pilot channel chosen — lowest volume, ideally one you control end-to-end for the first test.

## Step 1 — Pick the pilot channel (read-only)
```sql
select id, name, dispatch_cutover_enabled
from intake_channels
order by name;
```
Note the `id` of the single channel to pilot.

## Step 2 — Flip exactly ONE channel ON
```sql
update intake_channels
set dispatch_cutover_enabled = true
where id = '<PILOT_CHANNEL_ID>';      -- one row only

-- confirm exactly one channel is now ON:
select id, name, dispatch_cutover_enabled
from intake_channels
where dispatch_cutover_enabled = true;
```

## Step 3 — Verify the cutover create path
Run a **real intake on the pilot channel** (or a controlled test customer). Expect:
- `POST /api/tickets` on that channel returns `tracking_token` + `tracking_path: "/t/{token}"`
  **non-null** (legacy channels still return both null).
- Opening `https://cluexp-intake.vercel.app/t/{token}` shows the live tracking page.
- The job advances through the operational ladder (`pending_dispatch → assigned → en_route →
  arrived → in_progress → completed_pending_customer`), the tech `PATCH /tickets/{id}/status`
  works, and the customer `confirm`/`review`/`dispute` actions resolve on the token link.
- `completed_confirmed` is reachable **only** from the customer link, never the tech endpoint (403).

## Step 4 — Monitor (first hours)
- Watch Vercel logs + Supabase for errors on the cutover routes.
- Confirm the 72h auto-close sweep behaves (a `completed_pending_customer` job past the window
  auto-closes — `AUTO_CLOSE_WINDOW_SECONDS`, default 259200).
- Check no legacy channel changed behavior (they should all still return null tokens).

## Rollback — two levers, both instant
1. **Single channel** (preferred, surgical):
   ```sql
   update intake_channels set dispatch_cutover_enabled = false where id = '<PILOT_CHANNEL_ID>';
   ```
2. **Global kill-switch** (everything back to legacy, no DB edit): set env var on the Vercel
   `cluexp-intake` project **`DISPATCH_CUTOVER_GLOBAL_OFF=true`** and redeploy/restart. This forces
   every channel to the legacy stub regardless of its per-row flag. Unset it to resume.

In-flight jobs already created under cutover keep their tracking links; rollback only affects
*new* intakes on that channel.

## Hard rules
- **One channel at a time.** Do not bulk-enable.
- Do not flip during peak volume for the first pilot.
- Keep the kill-switch (`DISPATCH_CUTOVER_GLOBAL_OFF`) one action away at all times.
- Each additional channel flip is its own authorized go-live — repeat Steps 2–4.
