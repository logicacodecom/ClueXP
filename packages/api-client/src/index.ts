export * from "./types";

// Fulfillment cutover (Sprint 3) - API client functions for customer tracking

/** Get tracking status by token (customer endpoint) */
export async function getTrackingByToken(token: string): Promise<import("./types").TrackingWithStatus> {
  const res = await fetch(`/api/t/${token}`, {
    headers: { "content-type": "application/json" }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Cancel request (customer endpoint) */
export async function cancelRequest(token: string, reason?: string | null): Promise<{ status: string }> {
  const res = await fetch(`/api/t/${token}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: reason ?? null })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Confirm completion (customer endpoint) */
export async function confirmCompletion(token: string): Promise<{ status: string }> {
  const res = await fetch(`/api/t/${token}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Submit review (customer endpoint) */
export async function submitReview(
  token: string,
  rating: number,
  comment?: string | null,
  issueReported?: boolean
): Promise<{ status: string; review?: Record<string, unknown> }> {
  const res = await fetch(`/api/t/${token}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rating,
      comment: comment ?? null,
      issue_reported: issueReported ?? false
    })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Dispute completion (customer endpoint) */
export async function disputeCompletion(
  token: string,
  reason?: string | null
): Promise<{ status: string }> {
  const res = await fetch(`/api/t/${token}/dispute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: reason ?? null })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Update technician job status (technician endpoint) */
export async function updateTechnicianJobStatus(
  jobId: string,
  newStatus: "en_route" | "arrived" | "in_progress" | "completed_pending_customer"
): Promise<{ status: string }> {
  const res = await fetch(`/api/tickets/${jobId}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: newStatus })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

/** Get technician's active job */
export async function getActiveJob(): Promise<import("./types").Job | null> {
  const res = await fetch(`/api/active-job`, {
    headers: { "content-type": "application/json" }
  });
  if (!res.ok) {
    if (res.status === 401) return null;
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export * from "./mock-data";
