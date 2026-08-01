import type { QueuedMutation } from "../types";

export async function initOutbox() {
  return;
}

export async function enqueueMutation(_mutation: QueuedMutation) {
  return;
}

export async function queuedMutationCount() {
  return 0;
}

export async function queuedMutations(_limit = 25): Promise<QueuedMutation[]> {
  return [];
}

export type FailedMutation = {
  clientMutationId: string;
  jobId: string;
  kind: QueuedMutation["kind"];
  lastError: string | null;
  updatedAt: string;
};

export async function failedMutationCount() {
  return 0;
}

export async function failedMutations(_limit = 25): Promise<FailedMutation[]> {
  return [];
}

export async function markMutationDone(_clientMutationId: string) {
  return;
}

export async function markMutationFailed(_clientMutationId: string, _detail: string) {
  return;
}

export async function wipeOutbox() {
  return;
}
