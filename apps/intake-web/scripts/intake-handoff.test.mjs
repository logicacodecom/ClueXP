// Run: node --test apps/intake-web/scripts/intake-handoff.test.mjs  (Node >= 23.6 strips TS types)
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseHandoff, shouldAutocomplete } from "../src/app/intake-handoff.ts";

const hash = (params) => "#" + new URLSearchParams(params).toString();
const valid = { skill: "locksmith.residential_lockout", lat: "43.648", lng: "-79.384", address: "221 King St W, Toronto", src: "ai_assistant" };
const website = { src: "cluexp_website", skill: "locksmith.residential_lockout", zip: "33602", address: "123 Main St", notes: "Locked out" };

test("residential and vehicle skills pre-select their intake bucket", () => {
  assert.equal(parseHandoff(hash(valid)).accessType, "home");
  assert.equal(parseHandoff(hash({ ...valid, skill: "locksmith.vehicle_lockout" })).accessType, "vehicle");
  assert.equal(parseHandoff(hash({ ...valid, skill: "locksmith.commercial_lockout" })).accessType, "business");
});

test("unsupported skill keeps the location but pre-selects nothing", () => {
  const prefill = parseHandoff(hash({ ...valid, skill: "locksmith.smart_lock" }));
  assert.equal(prefill.accessType, null);
  assert.equal(prefill.situation, null);
  assert.equal(prefill.location.raw_text, "221 King St W, Toronto");
});

test("assistant handoff keeps its trusted coordinates and attribution", () => {
  const prefill = parseHandoff(hash(valid));
  assert.equal(prefill.source, "ai_assistant");
  assert.equal(prefill.locationConfidence, "coordinates");
  assert.deepEqual(prefill.location, { raw_text: "221 King St W, Toronto", lat: 43.648, lng: -79.384, geocode_confidence: "high" });
});

test("only well-formed assistant fragments are accepted", () => {
  assert.equal(parseHandoff(""), null);
  assert.equal(parseHandoff(hash({ ...valid, src: "other" })), null);
  assert.equal(parseHandoff(hash({ ...valid, lat: "999" })), null);
  assert.equal(parseHandoff(hash({ ...valid, lat: "" })), null);
  assert.equal(parseHandoff(hash({ ...valid, lng: "not-a-number" })), null);
});

test("website handoff prefills unconfirmed text and never a location", () => {
  const prefill = parseHandoff(hash(website));
  assert.deepEqual(prefill, {
    source: "cluexp_website",
    accessType: "home",
    situation: "locked_out",
    address: "123 Main St",
    notes: "Locked out",
    zip: "33602",
    locationConfidence: "typed_unconfirmed",
    location: null
  });
});

test("legacy src=website normalizes to cluexp_website", () => {
  assert.deepEqual(parseHandoff(hash({ ...website, src: "website" })), parseHandoff(hash(website)));
});

test("website handoff ignores coordinates and never derives one from ZIP", () => {
  const prefill = parseHandoff(hash({ ...website, lat: "27.95", lng: "-82.46" }));
  assert.equal(prefill.location, null);
  const zipOnly = parseHandoff(hash({ src: "cluexp_website", zip: "33602" }));
  assert.equal(zipOnly.location, null);
  assert.equal(zipOnly.locationConfidence, "zip_hint");
  assert.equal(parseHandoff(hash({ src: "cluexp_website" })).locationConfidence, "none");
  assert.equal(parseHandoff(hash({ src: "cluexp_website", zip: "<script>" })).zip, null);
});

test("website text is capped like the Website (address 300, notes 500)", () => {
  const prefill = parseHandoff(hash({ ...website, address: "a".repeat(400), notes: "n".repeat(900) }));
  assert.equal(prefill.address.length, 300);
  assert.equal(prefill.notes.length, 500);
});

test("unknown or prototype-shaped sources fail closed", () => {
  for (const src of ["provider_website", "constructor", "__proto__", "toString", "WEBSITE", ""]) {
    assert.equal(parseHandoff(hash({ ...website, src })), null, src);
  }
  assert.equal(parseHandoff(hash({ skill: website.skill, address: website.address })), null);
});

test("other skills suggest their situation chip", () => {
  assert.equal(parseHandoff(hash({ ...website, skill: "locksmith.rekey" })).situation, "rekey");
  assert.equal(parseHandoff(hash({ ...website, skill: "locksmith.broken_key" })).situation, "broken_key");
  assert.equal(parseHandoff(hash({ ...website, skill: "locksmith.vehicle_key_programming" })).situation, null);
});

test("a handed-off address never triggers the address-bearing autocomplete request", () => {
  assert.equal(shouldAutocomplete(parseHandoff(hash(valid)).address, false), false);
  assert.equal(shouldAutocomplete(parseHandoff(hash(website)).address, false), false);
  assert.equal(shouldAutocomplete("221 King", true), true);
  assert.equal(shouldAutocomplete("   ", true), false);
});
