import assert from "node:assert/strict";
import test from "node:test";
// The .web variant is the react-native-free half of the module — same pure
// predicates, importable under plain node.
import { isOfferPush, shouldAlarm } from "../src/features/offerAlarm.web.ts";

test("recognises the backend's offer push payload", () => {
  // Exactly what api/push.py _push_data emits for a new offer.
  assert.equal(
    isOfferPush({
      kind: "offer",
      notification_id: "n-1",
      url: "cluexp-tech://offers/of-1",
      urgent: true,
      job_id: "job-1",
      offer_id: "of-1",
      expires_at: "2026-08-03T10:05:00+00:00"
    }),
    true
  );
  assert.equal(isOfferPush({ kind: "job_offer", offer_id: "of-2" }), true);
  assert.equal(isOfferPush({ type: "offer" }), true);
});

test("does not treat ordinary alerts as an incoming offer", () => {
  assert.equal(isOfferPush({ kind: "message", job_id: "job-1" }), false);
  assert.equal(isOfferPush({ kind: "system" }), false);
  assert.equal(isOfferPush({}), false);
  assert.equal(isOfferPush(null), false);
  assert.equal(isOfferPush("offer"), false);
});

test("alarms while a live offer is on screen in the foreground", () => {
  assert.equal(
    shouldAlarm({ activeOfferId: "of-1", appActive: true, silencedOfferId: null }),
    true
  );
});

test("stays silent with no live offer — expired or already answered", () => {
  assert.equal(
    shouldAlarm({ activeOfferId: null, appActive: true, silencedOfferId: null }),
    false
  );
});

test("stays silent while backgrounded — the OS owns the alert there", () => {
  assert.equal(
    shouldAlarm({ activeOfferId: "of-1", appActive: false, silencedOfferId: null }),
    false
  );
});

test("silencing is per offer: this one stops, the next one still rings", () => {
  assert.equal(
    shouldAlarm({ activeOfferId: "of-1", appActive: true, silencedOfferId: "of-1" }),
    false
  );
  assert.equal(
    shouldAlarm({ activeOfferId: "of-2", appActive: true, silencedOfferId: "of-1" }),
    true
  );
});
