# Job Communication Hub

> **Status:** Product design approved for implementation planning.
>
> **Updated:** 2026-08-02
>
> **Scope:** job-scoped messaging and mediated calling across technician-native,
> technician-web, provider-web, customer tracking, and the FastAPI backend.
>
> **Why this exists:** messaging and masked calling are not missing only from the
> native app. They are a whole-product gap. The web technician surfaces are stubs,
> and native currently mirrors that limitation. This document defines the product
> and technical contract to build next.

## 1. Product Position

The communication layer must help a field technician, customer, and owning company
operations coordinate one live job without exposing private phone numbers or leaking
cross-tenant information.

It is not a generic inbox, social chat, or platform-wide support feed. It is a
job-scoped command surface attached to the active job and the provider recovery
workspace.

### MVP Channels

1. **Customer**
   - Assigned technician <-> customer for the specific job.
   - Starts template-first for safety, clarity, and support control.
   - May add limited free text after delivery, audit, moderation, and support rules
     are proven.

2. **Company Operations**
   - Assigned technician <-> owning provider's dispatcher/provider operations.
   - Free-text from day one.
   - Used for delays, access issues, approvals, customer unavailable, parts, unsafe
     non-emergency context, and closeout/customer-confirmation questions.

3. **System Timeline**
   - Read-only lifecycle events that appear near the thread when useful.
   - Must never impersonate a human message.

### Calling

Masked/mediated calling launches from the same job communication hub but should
ship after messaging stabilizes.

MVP calling order:
1. Company operations call path.
2. Customer masked call path.
3. Provider selection and call-session audit.

Do not expose raw customer personal phone numbers to technicians as the fallback.

## 2. User Experience

### Technician Active Job

The active-job command rail keeps **Message**, **Call**, **Safety**, and **More**.
Selecting **Message** opens a communication hub with two tabs:

- **Customer**
- **Operations**

Each tab shows:
- thread title and job context;
- online/offline send state;
- sender role and timestamp;
- delivery state: `sending`, `sent`, `delivered`, `read`, `failed`;
- unread count;
- retry affordance for failed outgoing messages;
- "not available" reason when the channel is disabled by lifecycle/policy.

Customer tab composer:
- template-first quick actions:
  - `on_my_way`
  - `arrived`
  - `running_late`
  - `need_more_details`
  - `customer_unavailable`
  - `work_complete`
  - `please_confirm`
- optional template parameters, for example late minutes.
- no free text in MVP unless product explicitly enables it.

Operations tab composer:
- free text;
- quick actions:
  - customer unavailable;
  - need approval;
  - wrong address/access problem;
  - running late;
  - need part/extra charge;
  - non-emergency safety concern.

Driving safety:
- while `en_route`, prioritize large quick replies and external navigation.
- do not require typing while driving.
- safety/emergency remains a separate flow, not chat.

### Provider Operations

Provider job detail/recovery workspace gets a **Messages** panel:

- tabs or filters for Customer, Technician, Operations, System;
- dispatcher/provider_admin can send Operations messages to the assigned tech;
- customer-visible messages are clearly labeled before sending;
- unread and urgent indicators surface in queue/detail views;
- urgent operations messages can require technician acknowledgement in a later slice.

Provider internal notes remain separate. Internal notes must never leak into customer
or technician message streams.

### Customer Tracking

Customer tracking page gets a simple job message panel after assignment:

- customer can receive technician template messages;
- customer can send a reply or choose templates according to policy;
- no account creation required;
- authorization is the existing tracking token capability;
- never show provider-internal Operations messages.

## 3. Backend Model

### Tables

`job_message_threads`

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `job_id` | FK to jobs |
| `channel` | `customer` or `operations` |
| `created_at` | server timestamp |
| `closed_at` | nullable |

`job_messages`

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `thread_id` | FK to job_message_threads |
| `job_id` | denormalized for index/scoping |
| `channel` | `customer` or `operations` |
| `sender_type` | `technician`, `customer`, `dispatcher`, `provider_admin`, `system` |
| `sender_user_id` | nullable; auth user id when applicable |
| `sender_technician_id` | nullable |
| `sender_organization_id` | nullable |
| `body` | normalized text, nullable for pure template/system events |
| `template_code` | nullable |
| `template_params` | JSONB |
| `client_message_id` | nullable idempotency key |
| `metadata` | JSONB, no secrets |
| `created_at` | server timestamp |
| `edited_at` | nullable, not MVP |
| `deleted_at` | nullable, soft-delete/audit only |

`job_message_receipts`

| Column | Notes |
|---|---|
| `message_id` | FK to job_messages |
| `recipient_type` | `technician`, `customer`, `dispatcher`, `provider_admin` |
| `recipient_user_id` | nullable |
| `recipient_technician_id` | nullable |
| `recipient_organization_id` | nullable |
| `delivered_at` | nullable |
| `read_at` | nullable |
| `push_sent_at` | nullable |
| `push_error` | nullable |

`job_call_sessions` later

| Column | Notes |
|---|---|
| `id` | UUID primary key |
| `job_id` | FK to jobs |
| `channel` | `customer` or `operations` |
| `caller_type` | technician/customer/dispatcher/provider_admin |
| `callee_type` | technician/customer/operations |
| `provider` | e.g. `twilio`, nullable until selected |
| `provider_call_sid` | nullable |
| `masked_number` | nullable |
| `status` | requested/ringing/connected/failed/completed |
| `started_at` | nullable |
| `ended_at` | nullable |
| `metadata` | JSONB |

### Constraints

- Unique idempotency index:
  `(job_id, sender_type, sender_user_id, client_message_id)` where
  `client_message_id is not null`.
- Index message reads by `(job_id, channel, created_at)`.
- Retain audit history. Deletes are policy redactions, not physical deletion in normal use.

## 4. Authorization Rules

All reads and writes are job-scoped.

Technician:
- may read/write customer and operations threads only for their assigned active job;
- may read limited retained history for their own completed jobs during support window;
- loses write access immediately on release/reassignment;
- cannot see provider internal notes.

Provider dispatcher/provider_admin:
- may read/write operations thread for jobs owned or fulfilled by their active organization;
- may read customer thread for the same tenant-scoped jobs;
- customer-visible sends must be explicitly marked customer-visible;
- foreign jobs return 404, not 403 with existence leak.

Customer:
- authorizes by tracking token;
- may read/write only the customer channel for that job;
- never sees operations messages or internal notes.

ClueXP Ops/platform_admin:
- read-only oversight, if product approves;
- no dispatch-like intervention through message send unless a separate support role is designed.

## 5. API Shape

Technician:

```text
GET  /jobs/{job_id}/messages?channel=customer|operations&after=<cursor>
POST /jobs/{job_id}/messages
POST /jobs/{job_id}/messages/{message_id}/read
```

`POST /jobs/{job_id}/messages`

```json
{
  "channel": "operations",
  "body": "Customer is not answering the door.",
  "template_code": null,
  "template_params": {},
  "client_message_id": "msg_..."
}
```

Provider:

```text
GET  /provider/jobs/{job_id}/messages?channel=customer|operations&after=<cursor>
POST /provider/jobs/{job_id}/messages
POST /provider/jobs/{job_id}/messages/{message_id}/read
```

Customer tracking token:

```text
GET  /t/{token}/messages?after=<cursor>
POST /t/{token}/messages
POST /t/{token}/messages/{message_id}/read
```

Calling later:

```text
POST /jobs/{job_id}/calls/customer
POST /jobs/{job_id}/calls/operations
POST /provider/jobs/{job_id}/calls/technician
POST /t/{token}/calls/technician
```

## 6. Native Offline and Push

Native outgoing messages use the existing encrypted outbox pattern:

- generate `client_message_id`;
- store pending message locally;
- show `sending`;
- on network recovery, replay idempotently;
- exact retry returns the same server message;
- conflicting retry returns a structured error and marks failed.

Push notifications:
- push is a hint only;
- app opens the exact job/channel;
- thread refetch is source of truth;
- notification body should default to privacy-preserving copy:
  `New message about your active job`.

Priority:
- operations messages during an active job are higher priority than ordinary customer chat;
- safety/cancellation/urgent dispatcher instructions are distinct alert types, not generic chat.

## 7. Rollout Plan

### Slice 1: Operations Messaging Backend

- migrations for threads/messages/receipts;
- technician operations read/send;
- provider operations read/send;
- tests for tenancy, self-scope, idempotency, and lifecycle write restrictions.

### Slice 2: Provider Operations UI

- provider job detail message panel;
- queue/detail unread indicators;
- dispatcher send/reply;
- no customer-facing messages yet.

### Slice 3: Native Operations UI

- replace native "not enabled" Message sheet with Operations thread;
- offline queue and retry;
- push-open routing when available.

### Slice 4: Customer Messaging

- customer tracking read/send;
- technician customer tab with templates;
- provider visibility into customer thread;
- lifecycle/support-window restrictions.

### Slice 5: Push Delivery

- provider/tech/customer message notification events;
- device routing;
- unread counters;
- failed-delivery observability.

### Slice 6: Masked Calling

- provider decision/ADR for voice provider;
- call-session table and audit;
- technician/customer/operations call actions;
- no raw customer number exposure.

## 8. Explicit Non-Goals For MVP

- full free-form customer chat from day one;
- group chat with multiple companies;
- cross-job inbox;
- exposing raw customer or technician phone numbers;
- in-app VoIP or turn-by-turn navigation;
- attachments before media scanning/type/size controls are designed;
- ClueXP Ops sending operational messages as if it were the owning dispatcher.

## 9. Acceptance Criteria

- A technician can send an operations message from an active job and see it in provider-web.
- A dispatcher can reply and the technician sees the reply in the same job thread.
- Foreign technicians and foreign providers cannot infer the thread exists.
- Offline native send queues, replays once, and does not duplicate.
- Customer channel is separate and cannot see operations messages.
- Message history survives app restart and backend deploy.
- Every message carries sender role, timestamp, channel, and delivery/read state.
- Existing safety/report-issue flows remain separate and continue to work.
