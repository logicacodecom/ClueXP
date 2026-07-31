# Technician Native Pilot QA

Use this checklist for the first installable Android/iOS pilot builds.

## Preconditions

- Backend is deployed and reachable at `https://intake.cluexp.com/api`.
- Demo accounts are present. Shared demo password is `123456`.
- At least one synthetic provider job can be created and assigned.
- Tester has an Android physical device and/or iPhone.
- For iOS builds, Apple Developer/TestFlight access is available.
- For Android internal builds, Play Console or direct internal APK/AAB distribution is available.

## Build Verification

- [ ] `npm install`
- [ ] `npm run test:api --workspace @cluexp/technician-native`
- [ ] `npm run typecheck --workspace @cluexp/technician-native`
- [ ] `npm run typecheck`
- [ ] `cd apps/technician-native && npx expo-doctor`
- [ ] `cd apps/technician-native && npx expo prebuild --no-install`
- [ ] Android internal build installs and opens.
- [ ] iOS internal/TestFlight build installs and opens.

## Login And Session

Use:

```text
jordan@cluexp.example
123456
```

- [ ] Login succeeds.
- [ ] App stores access token, refresh token, and session.
- [ ] Kill/reopen app restores session.
- [ ] Expired access token refreshes without full re-login.
- [ ] Concurrent refresh does not sign the technician out.
- [ ] Logout calls server revoke best-effort and clears local session.

## Readiness

- [ ] Readiness loads from server.
- [ ] Availability blocker displays correctly.
- [ ] Location blocker displays correctly.
- [ ] Push blocker displays correctly when no device token is registered.
- [ ] Active-job capacity blocker displays correctly while busy.

## Offer Flow

- [ ] Provider dispatcher creates or selects a synthetic demo job.
- [ ] Dispatcher assigns the job to the signed-in technician.
- [ ] Offer appears in the native app.
- [ ] Accept succeeds with bearer auth.
- [ ] Accepting another technician's offer is impossible or returns 404.
- [ ] Accepted job becomes the active job.

## Job Lifecycle

- [ ] Start route updates to `en_route`.
- [ ] Location update is sent before route start.
- [ ] Customer arrival PIN can be issued from tracking page/API.
- [ ] Correct PIN moves job to `arrived`.
- [ ] Wrong PIN shows a useful failure and does not advance.
- [ ] Start service updates to `in_progress`.
- [ ] Collection can be reported.
- [ ] Closeout moves job to `completed_pending_customer`.
- [ ] While `completed_pending_customer`, app keeps the job active and shows customer-review pending copy.
- [ ] While `completed_pending_customer`, readiness remains blocked by `busy`.
- [ ] Customer review/confirmation releases the active job.

## Offline And Interruption

- [ ] Queue a supported command while offline.
- [ ] Restart app while command is queued.
- [ ] Reconnect and verify replay succeeds once.
- [ ] Stale `expected_version` conflict refreshes state instead of silently overwriting.
- [ ] App resume after long background period keeps or refreshes session.
- [ ] App killed during active job restores server state on reopen.

## Native Runtime

- [ ] Location permission denied produces a repair path.
- [ ] Location permission granted sends fresh coordinates.
- [ ] Notification permission denied produces a repair path.
- [ ] Notification permission granted registers device token.
- [ ] Deep link `cluexp-tech://work` opens the Work tab.
- [ ] Deep link to offer/job refreshes server state.

## Push Launch Gate

These remain blocked until APNs/FCM provider credentials are configured:

- [ ] Background offer push arrives.
- [ ] Locked-phone offer push arrives with privacy-safe copy.
- [ ] Push tap opens the relevant offer/job.
- [ ] Delivery/ack/failure path is monitored.
- [ ] Polling fallback still works when push is delayed.

## Exit Criteria For Internal Pilot

- [ ] Android physical device passes Login, Readiness, Offer Flow, Job Lifecycle, Logout.
- [ ] iPhone physical device passes Login, Readiness, Offer Flow, Job Lifecycle, Logout.
- [ ] Offline replay tested on at least one platform.
- [ ] No unexpected sign-out during refresh/polling.
- [ ] Known push limitation is accepted for pilot or APNs/FCM is live.

