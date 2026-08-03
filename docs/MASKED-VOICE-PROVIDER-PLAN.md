# Masked Voice Provider Plan

Last reviewed: 2026-08-02

## Goal

Add job-scoped masked calling for ClueXP without exposing raw customer,
technician, dispatcher, or provider phone numbers.

Masked calling must be launched from the same Communication Hub authorization
boundary as job messages:

- technician -> customer
- technician -> company operations
- customer -> assigned technician
- provider dispatcher/admin -> assigned technician

The server remains the source of truth. Native and web clients request a call
session; the backend decides whether the caller is allowed, creates an audit
record, invokes the provider, and returns only provider-safe call state.

## Preferred Providers

### 1. Twilio Programmable Voice

Preferred default for launch.

Why:

- Mature US voice product, number inventory, call recording/transcription
  options, webhooks, and operational tooling.
- Twilio documents masked/voice-proxy use cases and describes two build paths:
  custom proxy with SMS/Voice APIs, or a prebuilt Proxy-style API.
- Twilio Conference lets ClueXP bridge parties while retaining server-side call
  control.
- Strong ecosystem and easier hiring/support.

Sources:

- Twilio masked calling definition:
  https://www.twilio.com/docs/glossary/what-is-masked-calling
- Twilio Voice Proxy overview:
  https://www.twilio.com/docs/glossary/what-is-voice-proxy
- Twilio Programmable Voice outbound calls:
  https://www.twilio.com/docs/voice/tutorials/how-to-make-outbound-phone-calls
- Twilio Voice Conference:
  https://www.twilio.com/docs/voice/conference

Recommended ClueXP pattern:

1. Buy a pool of ClueXP-owned voice numbers per launch market.
2. When a job call starts, create `job_call_sessions`.
3. Select a proxy number from the pool.
4. Place/bridge calls using Programmable Voice and/or Conference.
5. Receive status callbacks and update `job_call_sessions`.
6. Expire/recycle the proxy association when the job reaches terminal state plus
   a short support window.

Notes:

- Avoid exposing personal numbers as fallback.
- Do not rely on client-side dial URLs to raw customer numbers.
- Treat Twilio Proxy as a reference pattern; implement the ClueXP job-scoped
  rules in our backend so provider choice remains swappable.

### 2. Telnyx Voice API / Call Control

Strong alternative, especially if pricing, direct carrier control, or Call
Control flexibility wins.

Why:

- Telnyx Voice API exposes programmable call control, dial, bridge, queue,
  recording, and webhook flows.
- Bridge Calls can connect two call legs server-side.
- Often attractive for cost/control-sensitive teams.

Sources:

- Telnyx Voice API:
  https://telnyx.com/products/voice-api
- Telnyx Voice commands/resources:
  https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-commands-and-resources
- Telnyx Bridge Calls:
  https://developers.telnyx.com/api-reference/call-commands/bridge-calls
- Telnyx Dial:
  https://developers.telnyx.com/api-reference/call-commands/dial

Recommended ClueXP pattern:

1. Create a Telnyx Voice API application and number pool.
2. On call request, create two managed call legs.
3. Use Call Control `dial`/`bridge` to connect parties through the proxy number.
4. Store Telnyx call-control IDs/SIDs in `job_call_sessions.provider_call_sid`
   or `metadata`.
5. Update status through Telnyx webhooks.

### 3. Vonage Voice API

Viable third option if the team wants a provider with explicit masked-calling
guide material and broader CPaaS options.

Why:

- Vonage documents a masked calling flow: provision virtual numbers, map real
  numbers, handle inbound calls, reverse-map to virtual numbers, and proxy the
  call.

Source:

- Vonage masked calling guide:
  https://developer.vonage.com/en/voice/voice-api/guides/masked-calling

### 4. Sinch Voice API

Backup option.

Why:

- Sinch documents number masking with a single Sinch number and voice webhooks.
- Worth pricing/coverage comparison, but not preferred for ClueXP launch unless
  procurement or regional coverage favors it.

Source:

- Sinch number masking tutorial:
  https://developers.sinch.com/docs/voice/tutorials/number-masking

## Recommendation

Choose **Twilio Programmable Voice** for the first production launch unless
pricing or procurement blocks it.

Rationale:

- ClueXP needs fast, supportable masked calling more than maximum telecom
  control at launch.
- Twilio has the most familiar operational surface for small teams.
- The ClueXP backend already has provider-neutral `job_call_sessions`, so a
  later Telnyx adapter remains possible.

Use **Telnyx** as the first serious fallback if Twilio pricing, number
availability, or compliance requirements are worse in the target markets.

## Backend Contract

Current scaffold:

- `POST /jobs/{job_id}/calls/customer`
- `POST /jobs/{job_id}/calls/operations`
- `POST /provider/jobs/{job_id}/calls/technician`
- `POST /t/{token}/calls/technician`

Current response while no provider is configured:

```json
{
  "available": false,
  "message": "Masked calling provider is not configured.",
  "call": {
    "id": "uuid",
    "job_id": "uuid",
    "caller_type": "technician",
    "callee_type": "customer",
    "provider": null,
    "status": "unavailable",
    "provider_status": "skipped_no_provider",
    "masked_number": null,
    "created_at": "..."
  }
}
```

Target response once provider is live:

```json
{
  "available": true,
  "message": "Masked call session started.",
  "call": {
    "id": "uuid",
    "job_id": "uuid",
    "caller_type": "technician",
    "callee_type": "customer",
    "provider": "twilio",
    "status": "requested",
    "provider_status": "queued",
    "masked_number": "+1555...",
    "created_at": "..."
  }
}
```

Do not return raw callee phone numbers.

## Data Model

Use `job_call_sessions`:

- `job_id`
- `caller_type`, `caller_user_id`, `caller_technician_id`,
  `caller_organization_id`
- `callee_type`, `callee_user_id`, `callee_technician_id`,
  `callee_organization_id`
- `provider`
- `provider_call_sid`
- `masked_number`
- `status`
- `provider_status`
- `metadata`
- `created_at`, `connected_at`, `ended_at`

Provider-specific IDs belong in `provider_call_sid` and `metadata`, not in
client-visible response fields unless safe.

## Required Environment

Common:

- `VOICE_PROVIDER=twilio|telnyx|none`
- `VOICE_WEBHOOK_SECRET`
- `VOICE_DEFAULT_COUNTRY=US`
- `VOICE_CALL_TTL_MINUTES=120`
- `VOICE_POST_JOB_SUPPORT_TTL_MINUTES=60`

Twilio:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VOICE_APP_SID` or webhook URLs
- `TWILIO_PROXY_NUMBER_POOL`
- `TWILIO_STATUS_CALLBACK_SECRET` if separate from common webhook secret

Telnyx:

- `TELNYX_API_KEY`
- `TELNYX_CONNECTION_ID`
- `TELNYX_NUMBER_POOL`
- `TELNYX_WEBHOOK_PUBLIC_KEY` or configured signature verification secret

Never commit provider credentials.

## Implementation Steps

1. Provider adapter interface

   Add `api/voice.py`:

   - `VoiceProvider.start_call(session, caller, callee) -> VoiceStartResult`
   - `NullVoiceProvider` returns `skipped_no_provider`.
   - `TwilioVoiceProvider` and later `TelnyxVoiceProvider` implement the same
     interface.

2. Phone-number resolution

   Backend resolves real numbers server-side only:

   - technician phone from verified technician profile
   - customer phone from job/customer detail
   - operations phone from owning provider org/company profile

   Missing required number returns structured `409`:

   ```json
   {
     "code": "call_party_unreachable",
     "message": "A verified phone number is missing for this call."
   }
   ```

3. Call start

   Existing call endpoints:

   - authorize job scope
   - create `job_call_sessions`
   - call the selected provider
   - update status/provider fields
   - return a safe call object

4. Webhooks

   Add provider webhook endpoint:

   - verify provider signature
   - map provider call ID to `job_call_sessions`
   - update status transitions: `requested`, `ringing`, `connected`,
     `completed`, `failed`
   - store failure codes in `metadata`, not in user-facing copy

5. Number pool

   Maintain a provider number pool:

   - assign by market/country if possible
   - avoid reusing the same proxy number for overlapping sessions involving
     the same parties
   - recycle after job terminal state plus support TTL

6. Client UI

   Native:

   - keep the current Call sheet
   - show `masked_number` only if provider returns one
   - show clear fallback copy when unavailable

   Provider web:

   - add call button to job detail
   - show audited call status

   Customer tracking:

   - add “Call technician” only after assignment and only when the call endpoint
     returns available

7. Monitoring

   Track:

   - call request count
   - provider failure rate
   - connect rate
   - average time to connect
   - calls attempted after terminal job state
   - webhook signature failures

## Acceptance Criteria

- No client receives raw customer or technician phone numbers.
- Cross-tenant and wrong-technician call attempts return `404`.
- Closed jobs reject new calls except explicitly allowed post-job support window.
- Every call request creates `job_call_sessions`.
- Provider webhooks update call status idempotently.
- Native, provider web, and customer tracking show honest unavailable states when
  provider is disabled.
- Production smoke covers technician -> customer and customer -> technician on
  a disposable job.

## Open Decisions

- Twilio or Telnyx for launch.
- Whether operations calls route to the provider company's public dispatch
  number, a private call-center number, or a rotating operations pool.
- Whether call recording is enabled. If yes, add consent copy and retention
  policy before launch.
- Whether customer post-job support calling remains available after terminal
  state, and for how long.
- Whether SMS masking is needed later, or job messages remain the only text
  channel.
