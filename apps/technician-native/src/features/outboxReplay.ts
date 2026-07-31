import { ApiError, type CluexpApi } from "../api/client";
import { markMutationDone, markMutationFailed, queuedMutations } from "../storage/outbox";
import type { QueuedMutation } from "../types";

function stringField(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  return typeof value === "string" ? value : "";
}

function numberField(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function replayOne(api: CluexpApi, mutation: QueuedMutation) {
  const common = {
    expected_version: mutation.expectedVersion ?? undefined,
    client_mutation_id: mutation.clientMutationId
  };
  if (mutation.kind === "arrival_verify") {
    await api.verifyArrival(mutation.jobId, {
      ...common,
      pin: stringField(mutation.payload, "pin")
    });
    return;
  }
  if (mutation.kind === "report_issue") {
    await api.reportIssue(mutation.jobId, {
      ...common,
      kind: stringField(mutation.payload, "kind") || "cannot_complete",
      reason: stringField(mutation.payload, "reason")
    });
    return;
  }
  if (mutation.kind === "collection") {
    await api.reportCollection(mutation.jobId, {
      ...common,
      amount: numberField(mutation.payload, "amount"),
      method: stringField(mutation.payload, "method") || "cash"
    });
    return;
  }
  if (mutation.kind === "status") {
    await api.updateJobStatus(
      mutation.jobId,
      stringField(mutation.payload, "status"),
      mutation.expectedVersion
    );
  }
}

export async function replayQueuedMutations(api: CluexpApi) {
  const queued = await queuedMutations();
  let replayed = 0;
  let failed = 0;
  for (const mutation of queued) {
    try {
      await replayOne(api, mutation);
      await markMutationDone(mutation.clientMutationId);
      replayed += 1;
    } catch (cause) {
      if (cause instanceof ApiError && cause.problem.code === "version_conflict") {
        await markMutationFailed(mutation.clientMutationId, `version_conflict:${cause.problem.current_version ?? ""}`);
        failed += 1;
      } else if (cause instanceof ApiError && cause.problem.code === "idempotency_key_reuse") {
        await markMutationFailed(mutation.clientMutationId, "idempotency_key_reuse");
        failed += 1;
      } else if (cause instanceof TypeError) {
        break;
      } else {
        await markMutationFailed(mutation.clientMutationId, cause instanceof Error ? cause.message : "Replay failed");
        failed += 1;
      }
    }
  }
  return { replayed, failed };
}
