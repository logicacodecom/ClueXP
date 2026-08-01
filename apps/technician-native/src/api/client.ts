import type {
  ActiveJobDetail,
  ActiveJobSnapshot,
  ApiProblem,
  AuthSession,
  HistoryJob,
  LoginResponse,
  ReadinessSnapshot,
  SettlementPayload,
  TechnicianDocument,
  TechnicianOffer,
  TechPayment
} from "../types";
import type { ServiceCategory } from "../data/serviceCatalog";

// React Native's fetch/FormData accepts a plain {uri,name,type} descriptor for
// a file part — not a Blob/File like the browser. expo-image-picker and
// expo-document-picker results map directly onto this shape.
export type UploadFile = { uri: string; name: string; type: string };

const DEFAULT_API_BASE = "https://intake.cluexp.com";

type SessionHandlers = {
  onRefresh: (result: LoginResponse) => Promise<void>;
  onRefreshFailed: () => Promise<void>;
};

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
  private refreshToken: string | null;
  private refreshInFlight: Promise<LoginResponse> | null = null;
  private sessionHandlers: SessionHandlers | null = null;

  constructor(token: string | null) {
    this.token = token;
    this.refreshToken = null;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  currentAccessToken() {
    return this.token;
  }

  setSessionTokens(accessToken: string | null, refreshToken?: string | null) {
    this.token = accessToken;
    this.refreshToken = refreshToken ?? null;
  }

  configureSessionHandlers(handlers: SessionHandlers | null) {
    this.sessionHandlers = handlers;
  }

  private ensureRefreshed() {
    if (!this.refreshInFlight) {
      if (!this.refreshToken) {
        return Promise.reject(new ApiError({
          status: 401,
          code: "missing_refresh_token",
          message: "Refresh token is not available."
        }));
      }
      const token = this.refreshToken;
      this.refreshInFlight = this.refresh(token).finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async fetchJson(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    // FormData bodies (file uploads) must NOT get a manual content-type — fetch
    // sets its own multipart boundary. Only default JSON requests get one.
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    if (init.body && !isFormData && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (this.token) headers.set("authorization", `Bearer ${this.token}`);
    const response = await fetch(`${apiBaseUrl()}/api${path}`, { ...init, headers });
    const body = await parseBody(response);
    return { response, body };
  }

  private async request<T>(path: string, init: RequestInit = {}, options: { retryOnAuth?: boolean } = {}): Promise<T> {
    const { response, body } = await this.fetchJson(path, init);
    if (response.ok) return body as T;

    const shouldRefresh = options.retryOnAuth !== false && response.status === 401 && Boolean(this.token && this.refreshToken);
    if (shouldRefresh && this.refreshToken) {
      let refreshed: LoginResponse;
      try {
        refreshed = await this.ensureRefreshed();
      } catch (cause) {
        this.setSessionTokens(null, null);
        await this.sessionHandlers?.onRefreshFailed();
        if (cause instanceof ApiError) throw cause;
        throw new ApiError(problemFrom(response.status, body));
      }
      this.setSessionTokens(refreshed.access_token, refreshed.refresh_token);
      await this.sessionHandlers?.onRefresh(refreshed);
      const retry = await this.fetchJson(path, init);
      if (retry.response.ok) return retry.body as T;
      if (retry.response.status === 401) {
        this.setSessionTokens(null, null);
        await this.sessionHandlers?.onRefreshFailed();
      }
      throw new ApiError(problemFrom(retry.response.status, retry.body));
    }

    throw new ApiError(problemFrom(response.status, body));
  }

  async refresh(refreshToken: string): Promise<LoginResponse> {
    return this.request<LoginResponse>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken })
    }, { retryOnAuth: false });
  }

  async logout(refreshToken: string): Promise<{ revoked: boolean }> {
    return this.request<{ revoked: boolean }>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken })
    }, { retryOnAuth: false });
  }

  async login(identifier: string, password: string): Promise<LoginResponse> {
    return this.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password, want_refresh_token: true })
    }, { retryOnAuth: false });
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

  async activeJobDetail(technicianId: string): Promise<ActiveJobDetail> {
    return this.request<ActiveJobDetail>(`/technicians/${encodeURIComponent(technicianId)}/active-job`);
  }

  async serviceCatalog(): Promise<{ categories: ServiceCategory[] }> {
    return this.request<{ categories: ServiceCategory[] }>("/service-catalog");
  }

  async updateProfile(payload: {
    display_name?: string;
    phone?: string;
    skills?: string[];
    service_area_radius_km?: number;
  }): Promise<Record<string, unknown>> {
    return this.request("/technicians/me/profile", {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
  }

  async uploadPhoto(file: UploadFile): Promise<{ photo_url: string; photo_status: string; message: string }> {
    const form = new FormData();
    form.append("file", file as unknown as Blob);
    return this.request("/technicians/me/photo", { method: "POST", body: form });
  }

  async listDocuments(): Promise<TechnicianDocument[]> {
    return this.request<TechnicianDocument[]>("/technicians/me/documents");
  }

  async uploadDocument(
    file: UploadFile,
    documentType: string,
    options: { documentNumber?: string; expirationDate?: string } = {}
  ): Promise<TechnicianDocument & { message: string; download_url?: string | null }> {
    const form = new FormData();
    form.append("file", file as unknown as Blob);
    form.append("document_type", documentType);
    if (options.documentNumber) form.append("document_number", options.documentNumber);
    if (options.expirationDate) form.append("expiration_date", options.expirationDate);
    return this.request("/technicians/me/documents", { method: "POST", body: form });
  }

  async documentDownloadUrl(documentId: string): Promise<{ download_url: string }> {
    return this.request(`/technicians/me/documents/${encodeURIComponent(documentId)}/download`);
  }

  async jobHistory(): Promise<HistoryJob[]> {
    return this.request<HistoryJob[]>("/technician/jobs/history");
  }

  async settlements(): Promise<SettlementPayload> {
    return this.request<SettlementPayload>("/technician/settlements");
  }

  async payments(): Promise<TechPayment[]> {
    return this.request<TechPayment[]>("/technician/payments");
  }

  async createPayment(payload: {
    organization_id: string;
    amount_cents: number;
    payment_method: string;
    paid_on?: string;
    reference_number?: string;
    note?: string;
  }): Promise<TechPayment> {
    return this.request<TechPayment>("/technician/payments", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
}
