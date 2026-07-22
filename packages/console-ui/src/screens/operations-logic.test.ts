import test from "node:test";
import assert from "node:assert/strict";
import {
  compareOperationsRows,
  formatMinutes,
  groupTechnicians,
  locationFreshness,
  mergeOperationsRows,
  ongoingMinutes,
  requestRisk,
  sortOperationsRows,
  skillCodeFor,
  summarizeOperations,
  technicianStatusLabel,
  technicianSkillCodes,
  waitingMinutes,
  type ActiveJobRow,
  type FleetRow,
  type QueueRow,
} from "./operations-logic.ts";

const NOW = new Date("2026-07-20T12:00:00Z").getTime();

function iso(minutesAgo: number): string {
  return new Date(NOW - minutesAgo * 60_000).toISOString();
}

function first<T>(list: T[]): T {
  const item = list[0];
  assert.ok(item, "expected at least one row");
  return item;
}

function queueRow(overrides: Partial<QueueRow> & { id: string }): QueueRow {
  return {
    address: "123 Main St", lat: 1, lng: 2, access_type: "home", situation: "locked_out",
    urgency: "normal", created_at: iso(0), dispatch_attempts: 0, offer_active: false,
    offered_technician_id: null, offer_expires_at: null, last_decline_reason: null,
    decline_count: 0, ...overrides,
  };
}

function jobRow(overrides: Partial<ActiveJobRow> & { id: string; status: string }): ActiveJobRow {
  return {
    address: "456 Oak Ave", lat: 3, lng: 4, access_type: "home", situation: "locked_out",
    urgency: "normal", created_at: iso(30), fulfillment_technician_id: null,
    technician_display_name: null, technician_location_updated_at: null,
    active_status_started_at: null, offer_active: false, offer_expires_at: null,
    last_issue: null, ...overrides,
  };
}

test("mergeOperationsRows: queue-only row becomes a pending_dispatch request", () => {
  const row = first(mergeOperationsRows([queueRow({ id: "j1" })], []));
  assert.equal(row.status, "pending_dispatch");
  assert.equal(row.isRequest, true);
  assert.equal(row.address, "123 Main St");
});

test("mergeOperationsRows: jobs-only row keeps its active status", () => {
  const row = first(mergeOperationsRows([], [jobRow({ id: "j2", status: "en_route", technician_display_name: "Sam" })]));
  assert.equal(row.status, "en_route");
  assert.equal(row.isRequest, false);
  assert.equal(row.technician_display_name, "Sam");
});

test("mergeOperationsRows: overlapping id prefers queue pending-dispatch fields, keeps jobs technician context", () => {
  const row = first(mergeOperationsRows(
    [queueRow({ id: "j3", dispatch_attempts: 2, decline_count: 1, last_decline_reason: "no answer" })],
    [jobRow({ id: "j3", status: "pending_dispatch", technician_display_name: "Prior tech", active_status_started_at: iso(5) })],
  ));
  assert.equal(row.dispatch_attempts, 2);
  assert.equal(row.decline_count, 1);
  assert.equal(row.last_decline_reason, "no answer");
  assert.equal(row.technician_display_name, "Prior tech");
  assert.equal(row.active_status_started_at, iso(5));
});

test("waitingMinutes only applies to requests; ongoingMinutes only to active jobs", () => {
  const request = first(mergeOperationsRows([queueRow({ id: "r1", created_at: iso(12) })], []));
  const active = first(mergeOperationsRows([], [jobRow({ id: "a1", status: "in_progress", active_status_started_at: iso(8) })]));
  assert.equal(waitingMinutes(request, NOW), 12);
  assert.equal(ongoingMinutes(request, NOW), null);
  assert.equal(waitingMinutes(active, NOW), null);
  assert.equal(ongoingMinutes(active, NOW), 8);
});

test("ongoingMinutes truthfully reports unknown when active_status_started_at is missing", () => {
  const active = first(mergeOperationsRows([], [jobRow({ id: "a2", status: "disputed", active_status_started_at: null })]));
  assert.equal(ongoingMinutes(active, NOW), null);
});

test("formatMinutes", () => {
  assert.equal(formatMinutes(null), "—");
  assert.equal(formatMinutes(45), "45m");
  assert.equal(formatMinutes(125), "2h 5m");
});

test("requestRisk: critical urgency with no active offer", () => {
  const row = first(mergeOperationsRows([queueRow({ id: "r2", urgency: "critical", offer_active: false })], []));
  assert.equal(requestRisk(row, NOW, 5, 15), "critical");
});

test("requestRisk: an active offer suppresses risk regardless of wait", () => {
  const row = first(mergeOperationsRows([queueRow({ id: "r3", urgency: "critical", offer_active: true, created_at: iso(60) })], []));
  assert.equal(requestRisk(row, NOW, 5, 15), "normal");
});

test("requestRisk: stalled once past the stalled threshold", () => {
  const row = first(mergeOperationsRows([queueRow({ id: "r4", created_at: iso(20) })], []));
  assert.equal(requestRisk(row, NOW, 5, 15), "stalled");
});

test("requestRisk: ack-breached after the ack window with zero dispatch attempts", () => {
  const row = first(mergeOperationsRows([queueRow({ id: "r5", created_at: iso(7), dispatch_attempts: 0 })], []));
  assert.equal(requestRisk(row, NOW, 5, 15), "ack_breached");
});

test("requestRisk: not ack-breached once a dispatch attempt has gone out", () => {
  const row = first(mergeOperationsRows([queueRow({ id: "r6", created_at: iso(7), dispatch_attempts: 1 })], []));
  assert.equal(requestRisk(row, NOW, 5, 15), "normal");
});

test("sortOperationsRows: critical/stalled requests first, then at-risk, then oldest-waiting, then active jobs by longest ongoing", () => {
  const rows = mergeOperationsRows(
    [
      queueRow({ id: "normal-new", created_at: iso(1) }),
      queueRow({ id: "stalled", created_at: iso(20) }),
      queueRow({ id: "ack-breached", created_at: iso(7), dispatch_attempts: 0 }),
      queueRow({ id: "critical", urgency: "critical", created_at: iso(25) }),
    ],
    [
      jobRow({ id: "active-short", status: "assigned", active_status_started_at: iso(2) }),
      jobRow({ id: "active-long", status: "in_progress", active_status_started_at: iso(40) }),
    ],
  );
  const order = sortOperationsRows(rows, NOW, 5, 15).map((r) => r.id);
  assert.deepEqual(order, ["critical", "stalled", "ack-breached", "normal-new", "active-long", "active-short"]);
});

function fleetRow(overrides: Partial<FleetRow> & { id: string }): FleetRow {
  return {
    display_name: "Tech", skills: [], is_available: true, current_lat: 1, current_lng: 2,
    location_updated_at: iso(0), active_job: null, marker_status: "free", ...overrides,
  };
}

test("technicianStatusLabel only reports the three statuses the fleet feed supports", () => {
  assert.equal(technicianStatusLabel("free"), "Available");
  assert.equal(technicianStatusLabel("busy"), "Busy");
  assert.equal(technicianStatusLabel("inactive"), "Offline");
  assert.equal(technicianStatusLabel(null), "Offline");
  assert.equal(technicianStatusLabel(undefined), "Offline");
});

test("groupTechnicians buckets the fleet by status", () => {
  const groups = groupTechnicians([
    fleetRow({ id: "t1", marker_status: "free" }),
    fleetRow({ id: "t2", marker_status: "busy" }),
    fleetRow({ id: "t3", marker_status: "inactive" }),
    fleetRow({ id: "t4", marker_status: "free" }),
  ]);
  assert.equal(groups.Available.length, 2);
  assert.equal(groups.Busy.length, 1);
  assert.equal(groups.Offline.length, 1);
});

test("locationFreshness flags stale once past the threshold, without pretending a missing timestamp is fresh", () => {
  assert.deepEqual(locationFreshness(null, NOW, 15), { label: "no location", stale: true });
  assert.equal(locationFreshness(iso(3), NOW, 15).stale, false);
  assert.equal(locationFreshness(iso(20), NOW, 15).stale, true);
});

test("skillCodeFor maps backend skill identifiers to dispatcher-facing codes", () => {
  assert.deepEqual(skillCodeFor("LOCKSMITH.RESIDENTIAL_LOCKOUT"), { code: "LOCK", label: "Lockout" });
  assert.deepEqual(skillCodeFor("locksmith.commercial_rekey"), { code: "COM", label: "Commercial" });
  assert.deepEqual(skillCodeFor("locksmith.vehicle_lockout"), { code: "AUTO", label: "Automotive" });
});

test("technicianSkillCodes deduplicates and limits skill chips", () => {
  const result = technicianSkillCodes([
    "LOCKSMITH.RESIDENTIAL_LOCKOUT",
    "residential",
    "commercial",
    "vehicle",
    "safe_service",
  ]);
  assert.deepEqual(result.codes.map((item) => item.code), ["LOCK", "RES", "COM"]);
  assert.equal(result.overflow, 2);
});

test("summarizeOperations includes all workforce metric counts", () => {
  const summary = summarizeOperations([], [
    fleetRow({ id: "t1", marker_status: "free" }),
    fleetRow({ id: "t2", marker_status: "busy" }),
    fleetRow({ id: "t3", marker_status: "inactive" }),
  ], NOW, 5, 15);
  assert.equal(summary.availableTechnicians, 1);
  assert.equal(summary.busyTechnicians, 1);
  assert.equal(summary.offlineTechnicians, 1);
  assert.equal(summary.allTechnicians, 3);
});

test("compareOperationsRows treats every request as ranked before every active job", () => {
  const request = first(mergeOperationsRows([queueRow({ id: "req" })], []));
  const active = first(mergeOperationsRows([], [jobRow({ id: "act", status: "arrived", active_status_started_at: iso(1) })]));
  assert.ok(compareOperationsRows(request, active, NOW, 5, 15) < 0);
  assert.ok(compareOperationsRows(active, request, NOW, 5, 15) > 0);
});
