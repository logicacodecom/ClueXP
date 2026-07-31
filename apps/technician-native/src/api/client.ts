import type {
  ActiveJobSnapshot,
  ApiProblem,
  AuthSession,
  LoginResponse,
  ReadinessSnapshot,
  TechnicianOffer
} from "../types";

const DEFAULT_API_BASE = "https://intake.cluexp.com";

export class ApiError extends Error {
  problem: ApiProblem;

  constructor(problem: ApiProblem) {
    super(problem.message);
    this.name = "ApiError";
    this.problem = problem;
  }
}

function apiBaseUrl() {
  return (process.env.EXPO_PUBLIC_CLUEXP_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, "");
}

async function parseBody(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { detail: text };
  }
}

function problemFrom(status: number, body: unknown): ApiProblem {
  const detail = body && typeof body === "object" ? (body as Record<string, unknown>).detail : body;
  if (detail && typeof detail === "object") {
    const structured = detail as Record<string, unknown>;
    return {
      status,
      code: typeof structured.code === "string" ? structured.code : undefined,
      current_version: typeof structured.current_version === "string" ? structured.current_version : undefined,
      message: typeof structured.message === "string" ? structured.message : structured.code ? String(structured.code) : `Request failed: ${status}`,
      raw: body
    };
  }
  return {
    status,
    message: typeof detail === "string" ? detail : `Request failed: ${status}`,
    raw: body
  };
}

export class CluexpApi {
  private token: string | null;

  constructor(token: string | null) {
    this.token = token;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    const response = await fetch(`${apiBaseUrl()}/api${path}`, { ...init, headers });
    const body = await parseBody(response);
    if (!response.ok) throw new ApiError(problemFrom(response.status, body));
    return body as T;
  }

  async login(identifier: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password })
    });
  }

  async me(): Promise<AuthSession> {
    return this.request<AuthSession>("/auth/me");
  }

  async readiness(): Promise<ReadinessSnapshot> {
    return this.request<ReadinessSnapshot>("/technicians/me/readiness");
  }

  async activeJobSnapshot(): Promise<ActiveJobSnapshot> {
    return this.request<ActiveJobSnapshot>("/technicians/me/active-job/snapshot");
  }

  async offers(technicianId: string): Promise<{ offers: TechnicianOffer[] }> {
    return this.request<{ offers: TechnicianOffer[] }>(`/technicians/${encodeURIComponent(technicianId)}/offers`);
  }

  async acceptOffer(offerId: string): Promise<{ accepted: boolean; job_id?: string; reason?: string }> {
    return this.request(`/offers/${encodeURIComponent(offerId)}/accept`, { method: "POST" });
  }

  async declineOffer(offerId: string, reason?: string): Promise<{ declined: boolean }> {
    return this.request(`/offers/${encodeURIComponent(offerId)}/decline`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {})
    });
  }

  async setAvailability(isAvailable: boolean) {
    return this.request("/technicians/me/availability", {
      method: "PATCH",
      body: JSON.stringify({ is_available: isAvailable })
    });
  }

  async updateLocation(lat: number, lng: number) {
    return this.request<{ last_location_at?: string }>("/technicians/me/location", {
      method: "PATCH",
      body: JSON.stringify({ lat, lng })
    });
  }

  async registerDevice(payload: {
    platform: "ios" | "android";
    push_token: string;
    environment: "development" | "production";
    app_version?: string | null;
    installation_id?: string | null;
  }) {
    return this.request("/technicians/me/devices", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async updateJobStatus(jobId: string, status: string, expectedVersion?: string | null) {
    return this.request<{ status: string }>(`/tickets/${encodeURIComponent(jobId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, expected_version: expectedVersion ?? undefined })
    });
  }

  async verifyArrival(jobId: string, payload: Record<string, unknown>) {
    return this.request<{ status: string; verification_method?: string }>(`/jobs/${encodeURIComponent(jobId)}/arrival/verify`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async reportIssue(jobId: string, payload: Record<string, unknown>) {
    return this.request<{ reported: boolean; kind: string }>(`/jobs/${encodeURIComponent(jobId)}/report-issue`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async reportCollection(jobId: string, payload: Record<string, unknown>) {
    return this.request<Record<string, unknown>>(`/jobs/${encodeURIComponent(jobId)}/collection`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
}
