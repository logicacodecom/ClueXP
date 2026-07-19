# End-to-End Smoke Test

Purpose: one repeatable workflow before deploy or after major merges.

Use synthetic customer data only. Record evidence in the private pilot log, not this repo.

## 1. Provider setup

- Sign in to `https://partners.cluexp.com` as the Metro Key dispatcher.
- Confirm company profile customer-care phone is correct.
- Confirm Intake flow settings:
  - Upfront estimate is shown or hidden according to the test scenario.
- Confirm Dispatch queue thresholds:
  - Distance unit is expected, default `mi`.
- Confirm Company service capabilities use canonical codes such as `locksmith.vehicle_lockout`.

## 2. Customer intake

- Open `https://intake.cluexp.com/o/metro-key`.
- Confirm direct `https://intake.cluexp.com` does not show the full form.
- Submit a vehicle request:
  - situation: vehicle lockout or lost key
  - GPS/current location, then confirm readable address appears
  - vehicle make, model, color, year
  - upload at least one intake photo
  - identity/customer info
  - estimate step shown or terms-only path, depending on provider setting
- Confirm customer lands on `/t/{token}`.

## 3. Provider dispatch

- Open provider queue.
- Confirm the job appears for Metro Key only.
- Confirm queue details include address, service context, vehicle color, and photo count/thumbnail where available.
- Open candidates.
- Confirm distance unit matches provider setting.
- Assign Jordan Lee.

## 4. Technician app

- Sign in as Jordan Lee at `https://tech.cluexp.com`.
- Confirm active job appears after assignment/acceptance.
- Verify active job command surface shows, when backend provides them:
  - canonical service type
  - ETA range
  - distance
  - dispatch-visible location freshness/age
  - intake photos
  - recorded collection items
  - approval status
  - approval link opening the customer tracking page on the intake origin

## 5. Fulfillment states

Walk the job through:

- accepted / assigned
- en route
- arrived with customer PIN
- in progress
- collection recorded
- completed pending customer
- customer approved

Also check at least one negative/resolution path in a separate disposable job:

- customer dispute, or
- confirmation window expired / dispatcher resolution

## 6. Pass criteria

- No cross-tenant job visibility.
- No raw storage paths or raw internal IDs shown to customer.
- No fabricated ETA/payment/live-tracking claims.
- Bottom actions are visible and tappable on mobile.
- Technician UI has sane empty/error/resolved states.
- Customer approval link is absolute and opens correctly.
