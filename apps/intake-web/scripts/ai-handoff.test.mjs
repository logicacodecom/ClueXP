// Run: node --test apps/intake-web/scripts/ai-handoff.test.mjs  (Node >= 23.6 strips TS types)
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseAiPrefill, shouldAutocomplete } from "../src/app/ai-handoff.ts";

const hash = (params) => "#" + new URLSearchParams(params).toString();
const valid = { skill: "locksmith.residential_lockout", lat: "43.648", lng: "-79.384", address: "221 King St W, Toronto", src: "ai_assistant" };

test("residential and vehicle skills pre-select their intake bucket", () => {
  assert.equal(parseAiPrefill(hash(valid)).accessType, "home");
  assert.equal(parseAiPrefill(hash({ ...valid, skill: "locksmith.vehicle_lockout" })).accessType, "vehicle");
  assert.equal(parseAiPrefill(hash({ ...valid, skill: "locksmith.commercial_lockout" })).accessType, "business");
});

test("unsupported skill keeps the location but pre-selects nothing", () => {
  const prefill = parseAiPrefill(hash({ ...valid, skill: "locksmith.smart_lock" }));
  assert.equal(prefill.accessType, null);
  assert.equal(prefill.location.raw_text, "221 King St W, Toronto");
});

test("only well-formed assistant fragments are accepted", () => {
  assert.equal(parseAiPrefill(""), null);
  assert.equal(parseAiPrefill(hash({ ...valid, src: "other" })), null);
  assert.equal(parseAiPrefill(hash({ ...valid, lat: "999" })), null);
  assert.equal(parseAiPrefill(hash({ ...valid, lat: "" })), null);
  assert.equal(parseAiPrefill(hash({ ...valid, lng: "not-a-number" })), null);
});

test("a handed-off address never triggers the address-bearing autocomplete request", () => {
  const prefill = parseAiPrefill(hash(valid));
  assert.equal(shouldAutocomplete(prefill.location.raw_text, false), false);
  assert.equal(shouldAutocomplete("221 King", true), true);
  assert.equal(shouldAutocomplete("   ", true), false);
});
