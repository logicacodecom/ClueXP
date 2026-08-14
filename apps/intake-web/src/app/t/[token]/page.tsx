"use client";

import { useEffect, useState } from "react";
import type { TicketGuards } from "@/types/schema.generated";
import { useRouter, useParams } from "next/navigation";
import { LoaderCircle, ShieldCheck, Star } from "lucide-react";
import { LanguageSelect, useLocale } from "@cluexp/app-core";
import { TrackingMap } from "@/components/tracking-map";

type Screen =
  | "loading"
  | "waiting"
  | "matched"
  | "en_route"
  | "arrived"
  | "in_progress"
  | "completed_pending_customer"
  | "completed_confirmed"
  | "completed_auto_closed"
  | "disputed"
  | "cancelled"
  | "no_show"
  | "error";

interface DispatchAssignment {
  customer_owner: string | null;
  fulfillment_type: "company_technician" | "independent_technician" | "network_provider";
  provider_company: string | null;
  technician_display_name: string;
  technician_photo_url: string | null;
  role: string;
  rating: number | null;
  eta_min: number;
  eta_max: number;
  eta_is_estimate: boolean;
  assigned_at: string;
  job_status: string;
  live_lat: number | null;
  live_lng: number | null;
  location_updated_at: string | null;
}

interface PaymentView {
  amount: number;
  currency: string;
  method: string;
}

interface CloseoutLineView {
  line_number: number;
  item_type_code: string;
  description: string;
  quantity: number;
  unit_amount_cents: number;
  line_total_cents: number;
  taxable: boolean;
  provided_by?: string | null;
  note?: string | null;
}

interface CloseoutView {
  currency: string;
  method: string;
  subtotal_cents: number;
  tax_cents: number;
  tip_cents: number;
  card_fee_cents: number;
  total_cents: number;
  line_items: CloseoutLineView[];
}

interface TrackingResponse {
  ticket_id: string;
  token: string;
  trust_state: "intake" | "matched" | "fulfillment";
  status: string;
  access_type: string;
  situation: string;
  location: { raw_text: string };
  assignment: DispatchAssignment | null;
  destination: { lat: number; lng: number } | null;
  payment: PaymentView | null;
  closeout: CloseoutView | null;
  service_appointment?: ServiceAppointmentView | null;
  guards: TicketGuards;
  customer_actions: {
    can_cancel: boolean;
    can_confirm: boolean;
    can_review: boolean;
    can_dispute: boolean;
  };
  terminal: boolean;
  dispatch_phone?: string | null;
}

interface ServiceAppointmentView {
  requested_start?: string | null;
  requested_end?: string | null;
  timezone?: string | null;
  status?: string | null;
  partner_dispatch_allowed?: boolean;
}

interface JobMessage {
  id: string;
  sender_type: string;
  body: string | null;
  template_code?: string | null;
  template_params?: Record<string, unknown>;
  created_at: string | null;
  delivery_state?: string | null;
}

interface ReviewData {
  rating: number | null;
  tags: string[];
  comment: string;
}

type CustomerActions = TrackingResponse["customer_actions"];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

function toDateTimeLocal(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateTimeLocalToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function formatWindow(value: ServiceAppointmentView | null, locale: string): string {
  if (!value?.requested_start) return locale === "es" ? "Ventana pendiente" : "Window pending";
  const start = new Date(value.requested_start);
  const end = value.requested_end ? new Date(value.requested_end) : null;
  const language = locale === "es" ? "es-US" : "en-US";
  const startText = start.toLocaleString(language, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const endText = end && !Number.isNaN(end.getTime())
    ? end.toLocaleTimeString(language, { hour: "numeric", minute: "2-digit" })
    : null;
  return `${startText}${endText ? ` – ${endText}` : ""}${value.timezone ? ` ${value.timezone}` : ""}`;
}

const DISPATCH_PHONE = process.env.NEXT_PUBLIC_DISPATCH_PHONE || "+18005551234";
const emptyCustomerActions: CustomerActions = {
  can_cancel: false,
  can_confirm: false,
  can_review: false,
  can_dispute: false
};

const CUSTOMER_MESSAGE_TEMPLATES = [
  "need_more_details",
  "arrived",
  "running_late",
  "customer_unavailable",
  "please_confirm"
] as const;

// Display labels for the technician-reported payment method (read-only on the
// customer side). Mirrors the backend PAYMENT_METHODS set; "other" is the catch-all.
const PAYMENT_METHOD_LABELS: Record<string, { en: string; es: string }> = {
  credit_card: { en: "Credit card", es: "Tarjeta de crédito" },
  debit_card: { en: "Debit card", es: "Tarjeta de débito" },
  cash: { en: "Cash", es: "Efectivo" },
  check: { en: "Check", es: "Cheque" },
  zelle: { en: "Zelle", es: "Zelle" },
  cash_app: { en: "Cash App", es: "Cash App" },
  apple_pay: { en: "Apple Pay", es: "Apple Pay" },
  google_pay: { en: "Google Pay", es: "Google Pay" },
  venmo: { en: "Venmo", es: "Venmo" },
  paypal: { en: "PayPal", es: "PayPal" },
  other: { en: "Other", es: "Otro" }
};

function paymentMethodLabel(method: string, locale: string): string {
  const entry = PAYMENT_METHOD_LABELS[method];
  if (!entry) return method;
  return locale === "es" ? entry.es : entry.en;
}

function moneyFromCents(cents: number, currency = "USD"): string {
  const amount = (cents || 0) / 100;
  return currency === "USD" ? `$${amount.toFixed(2)}` : `${currency} ${amount.toFixed(2)}`;
}

function messageTemplateLabel(code: string | null | undefined, locale: string): string {
  const labels: Record<string, { en: string; es: string }> = {
    on_my_way: { en: "I'm on my way.", es: "Estoy en camino." },
    arrived: { en: "I'm here.", es: "Ya estoy aquí." },
    running_late: { en: "I'm running late.", es: "Voy retrasado." },
    need_more_details: { en: "I need more details.", es: "Necesito más detalles." },
    customer_unavailable: { en: "I can't reach you.", es: "No puedo comunicarme con usted." },
    work_complete: { en: "The work is complete.", es: "El trabajo está completo." },
    please_confirm: { en: "Please confirm the work.", es: "Por favor confirme el trabajo." }
  };
  if (!code) return "";
  const entry = labels[code];
  return entry ? (locale === "es" ? entry.es : entry.en) : code.replaceAll("_", " ");
}

function messageAuthor(sender: string, locale: string): string {
  if (sender === "customer") return locale === "es" ? "Usted" : "You";
  if (sender === "technician") return locale === "es" ? "Técnico" : "Technician";
  if (sender === "provider_admin" || sender === "dispatcher") return locale === "es" ? "Despacho" : "Dispatch";
  return locale === "es" ? "Sistema" : "System";
}

function TopBar() {
  const { locale } = useLocale();
  return (
    <header className="topbar">
      <div className="mark" aria-hidden="true">
        <ShieldCheck size={26} />
      </div>
      <div className="brand">
        <div className="wordmark">ClueXP</div>
        <div className="subtitle">
          {locale === "es" ? "Despacho de servicio urgente" : "Urgent Service Dispatch"}
        </div>
      </div>
      <LanguageSelect className="language-select" />
    </header>
  );
}

function AgentMessage({ children, support }: { children: React.ReactNode; support?: React.ReactNode }) {
  return (
    <>
      <h1 className="message">{children}</h1>
      {support ? <p className="support">{support}</p> : null}
    </>
  );
}

// Customer-safe assigned-technician identity: the approved photo when available,
// otherwise an initials avatar + "Photo pending verification" so we never imply a
// verified headshot that does not exist. Only rendered after assignment.
function TechnicianPhoto({ name, photoUrl, locale }: { name: string; photoUrl: string | null; locale: string }) {
  const initials = (name || "")
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const size = { width: 56, height: 56, borderRadius: "50%", flex: "0 0 auto" } as const;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={name} style={{ ...size, objectFit: "cover" }} />
      ) : (
        <div
          aria-hidden="true"
          style={{ ...size, display: "grid", placeItems: "center", background: "#1b1f26", color: "#8b94a0", fontWeight: 700 }}
        >
          {initials || "★"}
        </div>
      )}
      {!photoUrl ? (
        <span className="fine">
          {locale === "es" ? "Foto pendiente de verificación" : "Photo pending verification"}
        </span>
      ) : null}
    </div>
  );
}

function CustomerMessagesPanel({
  locale,
  messages,
  unreadCount,
  busy,
  error,
  onSend
}: {
  locale: string;
  messages: JobMessage[];
  unreadCount: number;
  busy: boolean;
  error: string | null;
  onSend: (templateCode: string) => void;
}) {
  return (
    <div className="panel">
      <p className="panel-title">
        {locale === "es" ? "Mensajes del trabajo" : "Job messages"}
        {unreadCount > 0 ? (
          <span className="pill" style={{ marginLeft: 8 }}>
            {unreadCount} {locale === "es" ? "nuevo" : "new"}
          </span>
        ) : null}
      </p>
      <p className="fine">
        {locale === "es"
          ? "Mensajes rápidos con el técnico sobre este trabajo. Operaciones internas no aparecen aquí."
          : "Quick messages with the technician for this job. Internal operations messages never appear here."}
      </p>
      <div className="stack" style={{ marginTop: 12 }}>
        {messages.length === 0 ? (
          <p className="fine">
            {locale === "es" ? "Aún no hay mensajes." : "No messages yet."}
          </p>
        ) : (
          messages.map((message) => (
            <div className="panel" key={message.id} style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                <strong>{messageAuthor(message.sender_type, locale)}</strong>
                <span className="fine">{message.created_at ? new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}</span>
              </div>
              <p className="fine" style={{ marginTop: 6 }}>
                {message.body || messageTemplateLabel(message.template_code, locale)}
              </p>
            </div>
          ))
        )}
      </div>
      <div className="chip-grid" style={{ marginTop: 14 }}>
        {CUSTOMER_MESSAGE_TEMPLATES.map((code) => (
          <button
            className="chip"
            disabled={busy}
            key={code}
            onClick={() => onSend(code)}
            type="button"
          >
            {messageTemplateLabel(code, locale)}
          </button>
        ))}
      </div>
      {error ? <p className="fine" style={{ color: "#f87171", marginTop: 10 }}>{error}</p> : null}
    </div>
  );
}

export default function TokenTrackingPage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;
  const { locale } = useLocale();

  const [screen, setScreen] = useState<Screen>("loading");
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<DispatchAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customerActions, setCustomerActions] = useState<CustomerActions>(emptyCustomerActions);
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [serviceAppointment, setServiceAppointment] = useState<ServiceAppointmentView | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleStart, setRescheduleStart] = useState("");
  const [rescheduleEnd, setRescheduleEnd] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [reviewData, setReviewData] = useState<ReviewData>({
    rating: null,
    tags: [],
    comment: ""
  });
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(null);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  const [closeout, setCloseout] = useState<CloseoutView | null>(null);
  const [arrivalPin, setArrivalPin] = useState<string | null>(null);
  const [dispatchPhone, setDispatchPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<JobMessage[]>([]);
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);

  const localeText = {
    waiting: {
      title: locale === "es" 
        ? "Buscando su técnico verificado..." 
        : "Still finding your verified technician…",
      support: locale === "es"
        ? "El especialista llegará en breve. Mantén esta página abierta para actualizaciones."
        : "Keep this page open for live updates.",
      action: locale === "es" ? "Volver a revisar" : "Check status again",
      terminal: locale === "es" 
        ? "Nuestro equipo de despacho se comunicará con usted." 
        : "Our dispatch team will reach out."
    },
    matched: {
      title: locale === "es" 
        ? "Un técnico verificado está asignado." 
        : "A verified specialist is assigned.",
      support: locale === "es"
        ? "El especialista está en camino. Mantén esta página abierta para actualizaciones en tiempo real."
        : "Keep this page open for live updates."
    },
    en_route: {
      title: locale === "es" ? "Especialista en camino." : "Specialist en route.",
      support: locale === "es"
        ? "El especialista está llegando. Puedes rastrear su ubicación en tiempo real."
        : "You can track their live location."
    },
    arrived: {
      title: locale === "es"
        ? "El técnico ha llegado."
        : "Technician has arrived.",
      support: locale === "es"
        ? "Por favor, déjelos entrar."
        : "Please let them in."
    },
    in_progress: {
      title: locale === "es" 
        ? "Trabajo en progreso." 
        : "Work in progress.",
      support: locale === "es"
        ? "El especialista está trabajando en su problema."
        : "The specialist is working on your issue."
    },
    completed_pending_customer: {
      title: locale === "es" 
        ? "Trabajo completado." 
        : "Work completed.",
      support: locale === "es"
        ? "Por favor, califique el servicio recibido."
        : "Please rate the service received."
    },
    completed_confirmed: {
      title: locale === "es" 
        ? "Gracias por su feedback." 
        : "Thanks for the feedback.",
      support: locale === "es"
        ? "Su revisión está registrada. Nos comprometemos a brindarle un servicio excepcional."
        : "Your review is recorded. We're committed to exceptional service."
    },
    completed_auto_closed: {
      title: locale === "es" 
        ? "Servicio finalizado." 
        : "Service completed.",
      support: locale === "es"
        ? "Esta solicitud ha sido cerrada automáticamente. Si necesita más ayuda, comuníquese con nosotros."
        : "This request has been automatically closed. Contact us if you need further help."
    },
    disputed: {
      title: locale === "es" 
        ? "Nuestro equipo seguirá con su caso." 
        : "Our team will follow up on your case.",
      support: locale === "es"
        ? "Un representante se pondrá en contacto con usted pronto para resolver su problema."
        : "A representative will contact you shortly to resolve your issue."
    },
    cancelled: {
      title: locale === "es"
        ? "Solicitud cancelada."
        : "Request cancelled.",
      support: locale === "es"
        ? "Esta solicitud ha sido cancelada. Si necesita más ayuda, comuníquese con nosotros."
        : "This request has been cancelled. Contact us if you need further help."
    },
    no_show: {
      title: locale === "es"
        ? "El técnico no se presentó."
        : "Technician did not show.",
      support: locale === "es"
        ? "Nos disculpamos por la falta de comunicación. Si necesita más ayuda, comuníquese con nosotros."
        : "We apologize for the lack of communication. Contact us if you need further help."
    }
  };

  const loadTracking = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/t/${token}`);
      
      // Handle 401 - Session expired
      if (response.status === 401) {
        setError(locale === "es" 
          ? "Sesión expirada, por favor actualice la página"
          : "Session expired, please refresh the page");
        setScreen("error");
        setBusy(false);
        return;
      }
      
      // Handle 403 - Not authorized (job mismatch or user mismatch)
      if (response.status === 403) {
        setError(locale === "es"
          ? "No está autorizado para ver este seguimiento"
          : "Not authorized to view this tracking");
        setScreen("error");
        setBusy(false);
        return;
      }
      
      // Handle 409 - Status changed, refresh
      if (response.status === 409) {
        setError(locale === "es"
          ? "El estado ha cambiado, actualizando..."
          : "Status changed, refreshing...");
        // Show a momentary message then refresh
        setTimeout(() => void loadTracking(), 1000);
        setBusy(false);
        return;
      }
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.detail ?? (locale === "es" 
          ? "Error al cargar el seguimiento" 
          : "Error loading tracking"));
        setScreen("error");
        setBusy(false);
        return;
      }
      
      const data = await response.json();
      setCurrentStatus(data.status ?? null);
      setAssignment(data.assignment);
      setDestination(data.destination ?? null);
      setPayment(data.payment ?? null);
      setCloseout(data.closeout ?? null);
      setServiceAppointment(data.service_appointment ?? null);
      setCustomerActions(data.customer_actions ?? emptyCustomerActions);
      setDispatchPhone(data.dispatch_phone ?? null);

      const TERMINAL: Record<string, Screen> = {
        completed_pending_customer: "completed_pending_customer",
        completed_confirmed: "completed_confirmed",
        completed_auto_closed: "completed_auto_closed",
        disputed: "disputed",
        cancelled: "cancelled",
        no_show: "no_show",
      };
      const ACTIVE_LIVE = new Set(["en_route", "arrived", "in_progress"]);

      const guards = data.guards ?? {};
      if (TERMINAL[data.status]) {
        setScreen(TERMINAL[data.status]);
      } else if (ACTIVE_LIVE.has(data.status)) {
        setScreen(data.status as Screen);
      } else if (data.assignment && guards.may_show_technician) {
        setScreen("matched");
      } else {
        setScreen("waiting");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tracking");
      setScreen("error");
    } finally {
      setBusy(false);
    }
  };

  const loadMessages = async () => {
    if (!token) return;
    try {
      const data = await api<{ messages: JobMessage[]; unread_count?: number }>(`/t/${token}/messages`);
      setMessages(data.messages ?? []);
      setMessageUnreadCount(data.unread_count ?? 0);
      if ((data.unread_count ?? 0) > 0) {
        void api<{ read_count: number }>(`/t/${token}/messages/read`, { method: "POST" })
          .then(() => setMessageUnreadCount(0))
          .catch(() => undefined);
      }
      setMessageError(null);
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : (locale === "es" ? "No se pudieron cargar los mensajes" : "Could not load messages"));
    }
  };

  const sendCustomerTemplate = async (templateCode: string) => {
    setMessageBusy(true);
    setMessageError(null);
    try {
      const data = await api<{ message: JobMessage }>(`/t/${token}/messages`, {
        method: "POST",
        body: JSON.stringify({
          channel: "customer",
          template_code: templateCode,
          client_message_id: `customer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
        })
      });
      setMessages((current) => [...current, data.message]);
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : (locale === "es" ? "No se pudo enviar el mensaje" : "Could not send message"));
    } finally {
      setMessageBusy(false);
    }
  };

  // Load tracking data on mount
  useEffect(() => {
    if (token) {
      void loadTracking();
      void loadMessages();
    }
  }, [token]);

  // Poll for updates
  useEffect(() => {
    if (screen === "waiting" || screen === "matched" || screen === "en_route" || screen === "arrived" || screen === "in_progress") {
      const interval = setInterval(() => {
        void loadTracking();
        void loadMessages();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [screen]);

  const submitReviewIfSelected = async () => {
    if (!reviewData.rating || reviewSubmitted || !customerActions.can_review) return true;
    const response = await fetch(`/api/t/${token}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating: reviewData.rating,
        tags: reviewData.tags,
        comment: reviewData.comment || null
      })
    });

    if (response.status === 401) {
      setError(locale === "es"
        ? "Sesión expirada, por favor actualice la página"
        : "Session expired, please refresh the page");
      return false;
    }

    if (response.status === 403) {
      setError(locale === "es"
        ? "No está autorizado para calificar este trabajo"
        : "Not authorized to review this job");
      return false;
    }

    if (response.status === 409) {
      setError(locale === "es"
        ? "El estado ha cambiado, actualizando..."
        : "Status changed, refreshing...");
      setTimeout(() => void loadTracking(), 1000);
      return false;
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.detail ?? (locale === "es"
        ? "Error al enviar la reseña"
        : "Error submitting review"));
      return false;
    }

    setReviewSubmitted(true);
    return true;
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      if (!(await submitReviewIfSelected())) return;

      const response = await fetch(`/api/t/${token}/confirm`, { method: "POST" });

      if (response.status === 401) {
        setError(locale === "es" 
          ? "Sesión expirada, por favor actualice la página"
          : "Session expired, please refresh the page");
        setBusy(false);
        return;
      }
      
      if (response.status === 403) {
        setError(locale === "es"
          ? "No está autorizado para confirmar este trabajo"
          : "Not authorized to confirm this job");
        setBusy(false);
        return;
      }
      
      if (response.status === 409) {
        setError(locale === "es"
          ? "El estado ha cambiado, actualizando..."
          : "Status changed, refreshing...");
        setTimeout(() => void loadTracking(), 1000);
        setBusy(false);
        return;
      }
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.detail ?? (locale === "es"
          ? "Error al confirmar el trabajo"
          : "Error confirming job"));
        setBusy(false);
        return;
      }
      
      setScreen("completed_confirmed");
    } catch (err) {
      setError(locale === "es"
        ? "Error de red, intente de nuevo"
        : "Network error, please try again");
    } finally {
      setBusy(false);
    }
  };

  const handleDispute = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/t/${token}/dispute`, { method: "POST" });
      
      if (response.status === 401) {
        setError(locale === "es" 
          ? "Sesión expirada, por favor actualice la página"
          : "Session expired, please refresh the page");
        setBusy(false);
        return;
      }
      
      if (response.status === 403) {
        setError(locale === "es"
          ? "No está autorizado para reportar este problema"
          : "Not authorized to report this issue");
        setBusy(false);
        return;
      }
      
      if (response.status === 409) {
        setError(locale === "es"
          ? "El estado ha cambiado, actualizando..."
          : "Status changed, refreshing...");
        setTimeout(() => void loadTracking(), 1000);
        setBusy(false);
        return;
      }
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.detail ?? (locale === "es"
          ? "Error al reportar el problema"
          : "Error reporting issue"));
        setBusy(false);
        return;
      }
      
      setScreen("disputed");
    } catch (err) {
      setError(locale === "es"
        ? "Error de red, intente de nuevo"
        : "Network error, please try again");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (reason?: string) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/t/${token}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      
      if (response.status === 401) {
        setError(locale === "es" 
          ? "Sesión expirada, por favor actualice la página"
          : "Session expired, please refresh the page");
        setBusy(false);
        return;
      }
      
      if (response.status === 403) {
        setError(locale === "es"
          ? "No está autorizado para cancelar esta solicitud"
          : "Not authorized to cancel this request");
        setBusy(false);
        return;
      }
      
      if (response.status === 409) {
        setError(locale === "es"
          ? "El estado ha cambiado, actualizando..."
          : "Status changed, refreshing...");
        setTimeout(() => void loadTracking(), 1000);
        setBusy(false);
        return;
      }
      
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.detail ?? (locale === "es"
          ? "Error al cancelar la solicitud"
          : "Error cancelling request"));
        setBusy(false);
        return;
      }
      
      setScreen("cancelled");
      setCancelReasonOpen(false);
      setCancelReason("");
    } catch (err) {
      setError(locale === "es"
        ? "Error de red, intente de nuevo"
        : "Network error, please try again");
    } finally {
      setBusy(false);
    }
  };

  const openReschedule = () => {
    setRescheduleStart(toDateTimeLocal(serviceAppointment?.requested_start));
    setRescheduleEnd(toDateTimeLocal(serviceAppointment?.requested_end));
    setRescheduleReason("");
    setRescheduleOpen(true);
  };

  const handleReschedule = async () => {
    setBusy(true);
    setError(null);
    const requestedStart = dateTimeLocalToIso(rescheduleStart);
    const requestedEnd = rescheduleEnd ? dateTimeLocalToIso(rescheduleEnd) : null;
    if (!requestedStart || (rescheduleEnd && !requestedEnd)) {
      setError(locale === "es" ? "Ingrese una fecha y hora válidas" : "Enter a valid date and time");
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(`/api/t/${token}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requested_start: requestedStart,
          requested_end: requestedEnd,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
          reason: rescheduleReason.trim() || null,
        })
      });
      if (response.status === 409) {
        setError(locale === "es" ? "El estado ha cambiado, actualizando..." : "Status changed, refreshing...");
        setTimeout(() => void loadTracking(), 1000);
        return;
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.detail ?? (locale === "es" ? "No se pudo cambiar la cita" : "Could not request a new appointment time"));
        return;
      }
      const data = await response.json();
      setServiceAppointment(data.service_appointment ?? null);
      setRescheduleOpen(false);
      setRescheduleReason("");
      await loadTracking();
      await loadMessages();
    } catch {
      setError(locale === "es" ? "Error de red, intente de nuevo" : "Network error, please try again");
    } finally {
      setBusy(false);
    }
  };

  const handleGetArrivalPin = async () => {
    setBusy(true);
    try {
      const response = await fetch(`/api/t/${token}/arrival-pin`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.detail ?? (locale === "es" ? "No se pudo generar el PIN" : "Could not generate PIN"));
        return;
      }
      const data = await response.json();
      setArrivalPin(data.pin);
    } catch {
      setError(locale === "es" ? "Error de red, intente de nuevo" : "Network error, please try again");
    } finally {
      setBusy(false);
    }
  };

  const renderCustomerMessages = () => (
      <CustomerMessagesPanel
        busy={messageBusy}
        error={messageError}
        locale={locale}
        messages={messages}
        unreadCount={messageUnreadCount}
        onSend={(code) => void sendCustomerTemplate(code)}
      />
  );

  const toggleReviewTag = (tag: string) => {
    setReviewData(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) 
        ? prev.tags.filter(t => t !== tag) 
        : [...prev.tags, tag]
    }));
  };

  // Customer cancellation always requires a reason (recorded by the backend).
  const renderCancelControl = () => {
    if (!customerActions.can_cancel) return null;
    const reasonValid = cancelReason.trim().length >= 3;
    return (
      <div className="panel">
        <p className="panel-title">
          {locale === "es" ? "Cancelar solicitud" : "Cancel request"}
        </p>
        {cancelReasonOpen ? (
          <>
            <textarea
              className="field"
              placeholder={locale === "es" ? "Motivo de la cancelación (obligatorio)" : "Reason for cancelling (required)"}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              aria-label={locale === "es" ? "Motivo de la cancelación" : "Reason for cancelling"}
            />
            <div className="row">
              <button className="ghost" type="button" onClick={() => setCancelReasonOpen(false)}>
                {locale === "es" ? "Mantener solicitud" : "Keep request"}
              </button>
              <button
                className="primary"
                type="button"
                disabled={!reasonValid || busy}
                onClick={() => void handleCancel(cancelReason.trim())}
              >
                {locale === "es" ? "Confirmar cancelación" : "Confirm cancel"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="fine">
              {locale === "es"
                ? "Puede cancelar antes de que el técnico llegue. Se requiere un motivo."
                : "You can cancel before the technician arrives. A reason is required."}
            </p>
            <button className="ghost" type="button" onClick={() => setCancelReasonOpen(true)}>
              {locale === "es" ? "Cancelar solicitud" : "Cancel request"}
            </button>
          </>
        )}
      </div>
    );
  };

  const renderScheduleControl = () => {
    if (!serviceAppointment || !["scheduled_requested", "scheduled_confirmed"].includes(currentStatus || "")) return null;
    const startValid = Boolean(rescheduleStart);
    const endValid = !rescheduleEnd || new Date(rescheduleEnd) > new Date(rescheduleStart);
    return (
      <div className="panel">
        <p className="panel-title">
          {locale === "es" ? "Cita solicitada" : "Requested appointment"}
        </p>
        <div className="big-number" style={{ fontSize: "1.35rem" }}>
          {formatWindow(serviceAppointment, locale)}
        </div>
        <p className="fine">
          {currentStatus === "scheduled_confirmed"
            ? (locale === "es"
              ? "El proveedor confirmó esta ventana. Si solicita otra hora, deberá confirmarse nuevamente."
              : "The provider confirmed this window. If you request a different time, it will need confirmation again.")
            : (locale === "es"
              ? "Esta ventana aún espera confirmación del proveedor."
              : "This window is still waiting for provider confirmation.")}
        </p>
        {rescheduleOpen ? (
          <div className="stack" style={{ marginTop: "1rem" }}>
            <label className="fine" htmlFor="reschedule-start">
              {locale === "es" ? "Nueva hora inicial" : "New start time"}
            </label>
            <input
              id="reschedule-start"
              className="field"
              type="datetime-local"
              value={rescheduleStart}
              onChange={(event) => setRescheduleStart(event.target.value)}
            />
            <label className="fine" htmlFor="reschedule-end">
              {locale === "es" ? "Nueva hora final" : "New end time"}
            </label>
            <input
              id="reschedule-end"
              className="field"
              type="datetime-local"
              value={rescheduleEnd}
              onChange={(event) => setRescheduleEnd(event.target.value)}
            />
            <textarea
              className="field"
              placeholder={locale === "es" ? "Motivo opcional" : "Optional reason"}
              value={rescheduleReason}
              onChange={(event) => setRescheduleReason(event.target.value)}
            />
            <div className="row">
              <button className="ghost" type="button" onClick={() => setRescheduleOpen(false)}>
                {locale === "es" ? "Mantener hora actual" : "Keep current time"}
              </button>
              <button
                className="primary"
                type="button"
                disabled={!startValid || !endValid || busy}
                onClick={() => void handleReschedule()}
              >
                {locale === "es" ? "Solicitar cambio" : "Request new time"}
              </button>
            </div>
            {!endValid ? (
              <p className="fine" role="alert">
                {locale === "es" ? "La hora final debe ser posterior a la inicial." : "End time must be after start time."}
              </p>
            ) : null}
          </div>
        ) : (
          <button className="ghost" type="button" onClick={openReschedule}>
            {locale === "es" ? "Solicitar otra hora" : "Request a different time"}
          </button>
        )}
      </div>
    );
  };

  if (screen === "loading") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <div className="dispatch-status">
            <div className="status-orbit" aria-hidden="true">
              <LoaderCircle className="status-spinner" size={28} />
            </div>
            <p>{locale === "es" ? "Cargando..." : "Loading..."}</p>
          </div>
        </main>
      </div>
    );
  }

  if (screen === "error") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage>
            {locale === "es" ? "Error al cargar el seguimiento" : "Error loading tracking"}
          </AgentMessage>
          {error && <p className="error">{error}</p>}
          <button 
            className="primary" 
            type="button" 
            onClick={() => void loadTracking()}
          >
            {locale === "es" ? "Reintentar" : "Try again"}
          </button>
        </main>
      </div>
    );
  }

  if (screen === "waiting") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.waiting.support}>
            {localeText.waiting.title}
          </AgentMessage>
          <div className="dispatch-status" aria-live="polite">
            <div className="status-orbit" aria-hidden="true">
              <LoaderCircle className="status-spinner" size={28} />
            </div>
            <div>
              <p className="panel-title">
                {locale === "es" ? "Enviado" : "Request sent"}
              </p>
              <div className="big-number">
                {locale === "es" ? "Buscando cercano" : "Searching nearby"}
              </div>
              <p className="fine">
                {locale === "es"
                  ? "Estamos verificando técnicos certificados. Puede mantener esta página abierta."
                  : "We are checking verified technicians. You can keep this page open."}
              </p>
            </div>
          </div>
          <div className="stack">
            <button
              className="primary"
              type="button"
              onClick={() => void loadTracking()}
            >
              {localeText.waiting.action}
            </button>
            {renderScheduleControl()}
            {renderCancelControl()}
            <a
              className="ghost"
              href={`tel:${dispatchPhone || DISPATCH_PHONE}`}
              style={{ display: "block", textAlign: "center", textDecoration: "none" }}
            >
              {locale === "es"
                ? "¿Necesita ayuda? Llamar al despacho"
                : "Need help? Call dispatch"}
            </a>
          </div>
        </main>
      </div>
    );
  }

  if (screen === "matched") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.matched.support}>
            {localeText.matched.title}
          </AgentMessage>
          {assignment && (
            <div className="panel">
              <p className="panel-title">
                {locale === "es" ? "Especialista" : "Specialist"}
              </p>
              <TechnicianPhoto name={assignment.technician_display_name} photoUrl={assignment.technician_photo_url} locale={locale} />
              <div className="big-number">
                {assignment.technician_display_name}
              </div>
              <p className="fine">
                {assignment.role}
                {assignment.rating != null
                  ? ` - ${locale === "es" ? "Calificación" : "rating"} ${assignment.rating}`
                  : ""}
              </p>
              {assignment.provider_company && (
                <p className="fine">
                  {locale === "es"
                    ? "Cumplido por"
                    : "Fulfilled by"} {assignment.provider_company}
                </p>
              )}
              <p className="fine">
                {locale === "es"
                  ? "Llegada estimada"
                  : "Estimated arrival"} {assignment.eta_min}-{assignment.eta_max} {locale === "es" ? "minutos" : "minutes"}.
              </p>
            </div>
          )}
          <div className="stack" style={{ marginTop: "2rem" }}>
            {renderCustomerMessages()}
          </div>
          {customerActions.can_cancel && (
            <div className="stack" style={{ marginTop: "2rem" }}>
              {renderCancelControl()}
            </div>
          )}
        </main>
      </div>
    );
  }

  if (screen === "en_route") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.en_route.support}>
            {localeText.en_route.title}
          </AgentMessage>
          <div className="stack">
            <TrackingMap
              tech={assignment?.live_lat != null && assignment?.live_lng != null
                ? { lat: assignment.live_lat, lng: assignment.live_lng } : null}
              destination={destination}
              label={assignment?.technician_display_name}
              liveExpected
              unavailableLabel={locale === "es"
                ? "Ubicación en vivo no disponible por el momento"
                : "Live location temporarily unavailable"}
            />
            <div className="panel">
              <p className="panel-title">
                {locale === "es"
                  ? "Llegada estimada"
                  : "Estimated arrival"}
              </p>
              <div className="big-number">
                {assignment?.eta_min}-{assignment?.eta_max} {locale === "es" ? "min" : "min"}
              </div>
              <p className="fine">
                {locale === "es"
                  ? "Esta es una estimación aproximada hasta que la ruta en vivo esté disponible."
                  : "This is a coarse estimate until live route tracking is available."}
              </p>
            </div>
            <div className="panel">
              <p className="panel-title">
                {locale === "es" ? "PIN de llegada" : "Arrival PIN"}
              </p>
              {arrivalPin ? (
                <>
                  <div className="big-number" style={{ letterSpacing: ".3em" }}>{arrivalPin}</div>
                  <p className="fine">
                    {locale === "es"
                      ? "Comparta este código con el técnico cuando llegue para confirmar su llegada."
                      : "Share this code with the technician when they arrive to confirm arrival."}
                  </p>
                </>
              ) : (
                <>
                  <p className="fine">
                    {locale === "es"
                      ? "Genere un PIN seguro y compártalo con el técnico solo cuando esté en su puerta."
                      : "Generate a secure PIN and share it with the technician only once they are at your door."}
                  </p>
                  <button className="primary" type="button" disabled={busy} onClick={() => void handleGetArrivalPin()}>
                    {locale === "es" ? "Mostrar PIN de llegada" : "Show arrival PIN"}
                  </button>
                </>
              )}
            </div>
            {renderCustomerMessages()}
          </div>
          {customerActions.can_cancel && (
            <div className="stack" style={{ marginTop: "2rem" }}>
              {renderCancelControl()}
            </div>
          )}
        </main>
      </div>
    );
  }

  if (screen === "arrived") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={locale === "es" ? "Por favor, déjelos entrar." : "Please let them in."}>
            {localeText.arrived.title}
          </AgentMessage>
          <TrackingMap
            tech={assignment?.live_lat != null && assignment?.live_lng != null
              ? { lat: assignment.live_lat, lng: assignment.live_lng } : null}
            destination={destination}
            label={assignment?.technician_display_name}
            liveExpected
            unavailableLabel={locale === "es"
              ? "Ubicación en vivo no disponible por el momento"
              : "Live location temporarily unavailable"}
          />
          {assignment && (
            <div className="panel">
              <p className="panel-title">
                {locale === "es" ? "Especialista" : "Specialist"}
              </p>
              <TechnicianPhoto name={assignment.technician_display_name} photoUrl={assignment.technician_photo_url} locale={locale} />
              <div className="big-number">{assignment.technician_display_name}</div>
              <p className="fine">{assignment.role}</p>
            </div>
          )}
          <div className="stack" style={{ marginTop: "2rem" }}>
            {renderCustomerMessages()}
          </div>
        </main>
      </div>
    );
  }

  if (screen === "in_progress") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.in_progress.support}>
            {localeText.in_progress.title}
          </AgentMessage>
          <TrackingMap
            tech={assignment?.live_lat != null && assignment?.live_lng != null
              ? { lat: assignment.live_lat, lng: assignment.live_lng } : null}
            destination={destination}
            label={assignment?.technician_display_name}
            liveExpected
            unavailableLabel={locale === "es"
              ? "Ubicación en vivo no disponible por el momento"
              : "Live location temporarily unavailable"}
          />
          <div className="panel">
            <p className="panel-title">
              {locale === "es"
                ? "Estado del trabajo"
                : "Job status"}
            </p>
            <div className="big-number">
              {locale === "es" ? "En progreso" : "In progress"}
            </div>
            <p className="fine">
              {locale === "es"
                ? "El especialista está trabajando en su problema."
                : "The specialist is working on your issue."}
            </p>
          </div>
          <div className="stack" style={{ marginTop: "2rem" }}>
            {renderCustomerMessages()}
          </div>
        </main>
      </div>
    );
  }

  if (screen === "completed_pending_customer") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.completed_pending_customer.support}>
            {localeText.completed_pending_customer.title}
          </AgentMessage>
          {renderCustomerMessages()}
          {closeout ? (
            <div className="panel">
              <p className="panel-title">
                {locale === "es" ? "Recibo" : "Receipt"}
              </p>
              <div className="stack">
                {closeout.line_items.map((item) => (
                  <div className="row" key={`${item.line_number}-${item.item_type_code}`} style={{ justifyContent: "space-between", gap: 12 }}>
                    <span className="fine" style={{ flex: 1 }}>
                      {item.description}
                      {item.quantity !== 1 ? ` × ${item.quantity}` : ""}
                    </span>
                    <strong>{moneyFromCents(item.line_total_cents, closeout.currency)}</strong>
                  </div>
                ))}
                <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                  <span className="fine">{locale === "es" ? "Subtotal" : "Subtotal"}</span>
                  <strong>{moneyFromCents(closeout.subtotal_cents, closeout.currency)}</strong>
                </div>
                {closeout.tax_cents > 0 ? (
                  <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                    <span className="fine">{locale === "es" ? "Impuesto" : "Tax"}</span>
                    <strong>{moneyFromCents(closeout.tax_cents, closeout.currency)}</strong>
                  </div>
                ) : null}
                {closeout.tip_cents > 0 ? (
                  <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                    <span className="fine">{locale === "es" ? "Propina" : "Tip"}</span>
                    <strong>{moneyFromCents(closeout.tip_cents, closeout.currency)}</strong>
                  </div>
                ) : null}
                {closeout.card_fee_cents > 0 ? (
                  <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                    <span className="fine">{locale === "es" ? "Cargo de tarjeta" : "Card fee"}</span>
                    <strong>{moneyFromCents(closeout.card_fee_cents, closeout.currency)}</strong>
                  </div>
                ) : null}
              </div>
              <div className="big-number">
                {moneyFromCents(closeout.total_cents, closeout.currency)}
              </div>
              <p className="fine">
                {locale === "es" ? "Método: " : "Method: "}
                {paymentMethodLabel(closeout.method, locale)}
              </p>
              <p className="fine">
                {locale === "es"
                  ? "Al confirmar que el trabajo está completo, usted reconoce este recibo."
                  : "By confirming the job is complete, you acknowledge this receipt."}
              </p>
            </div>
          ) : payment ? (
            <div className="panel">
              <p className="panel-title">
                {locale === "es" ? "Pago" : "Payment"}
              </p>
              <div className="big-number">
                {payment.currency === "USD" ? "$" : `${payment.currency} `}{payment.amount.toFixed(2)}
              </div>
              <p className="fine">
                {locale === "es" ? "Método: " : "Method: "}
                {paymentMethodLabel(payment.method, locale)}
              </p>
              <p className="fine">
                {locale === "es"
                  ? "Al confirmar que el trabajo está completo, usted reconoce este pago."
                  : "By confirming the job is complete, you acknowledge this payment."}
              </p>
            </div>
          ) : null}
          {reviewSubmitted ? (
            <div className="panel">
              <p className="panel-title">
                {locale === "es" ? "Reseña del trabajo" : "Job review"}
              </p>
              <div className="big-number">
                {reviewData.rating || 5}/5
              </div>
              <p className="fine">
                {locale === "es"
                  ? "Se aplica al especialista asignado y a la empresa de cumplimiento cuando uno fue responsable del trabajo."
                  : "Applies to the assigned specialist and fulfillment company when one was responsible for the job."}
              </p>
            </div>
          ) : (
            <div className="stack">
              <div className="panel">
                <p className="panel-title">
                  {locale === "es" ? "Calificación" : "Rating"}
                </p>
                <StarRating
                  emptyText={locale === "es" ? "Toque una estrella" : "Tap a star"}
                  label={locale === "es" ? "Calificación del servicio" : "Service rating"}
                  rating={reviewData.rating}
                  starText={locale === "es" ? "estrella" : "star"}
                  starsText={locale === "es" ? "estrellas" : "stars"}
                  onChange={(rating) => setReviewData(prev => ({ ...prev, rating }))}
                />
              </div>
              <div className="chip-grid">
                {[
                  { value: "arrived_fast", label: locale === "es" ? "Llegó rápido" : "Arrived fast" },
                  { value: "professional", label: locale === "es" ? "Profesional" : "Professional" },
                  { value: "solved_issue", label: locale === "es" ? "Resolvió problema" : "Solved issue" },
                  { value: "clear_price", label: locale === "es" ? "Precio claro" : "Clear price" },
                  { value: "felt_safe", label: locale === "es" ? "Se sintió seguro" : "Felt safe" },
                  { value: "needs_followup", label: locale === "es" ? "Necesita seguimiento" : "Needs follow-up" }
                ].map((tag) => (
                  <button
                    className={`chip ${reviewData.tags.includes(tag.value) ? "active" : ""}`}
                    key={tag.value}
                    type="button"
                    onClick={() => toggleReviewTag(tag.value)}
                  >
                    {tag.label}
                  </button>
                ))}
              </div>
              {reviewData.tags.length > 0 && (
                <p className="fine">
                  {locale === "es" ? "Seleccionado:" : "Selected:"} {reviewData.tags.join(", ")}
                </p>
              )}
              <textarea
                className="field"
                placeholder={locale === "es" ? "Comentario opcional" : "Optional comment"}
                value={reviewData.comment}
                onChange={(e) => setReviewData(prev => ({ ...prev, comment: e.target.value }))}
              />
            </div>
          )}
          <div className="stack">
            {customerActions.can_confirm ? (
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={handleConfirm}
              >
                {reviewData.rating
                  ? (locale === "es" ? "Confirmar y enviar reseña" : "Confirm & submit review")
                  : (locale === "es" ? "Confirmar completado" : "Confirm complete")}
              </button>
            ) : null}
            {customerActions.can_dispute ? (
            <button
              className="ghost"
              type="button"
              onClick={handleDispute}
            >
              {locale === "es" ? "Hay un problema" : "Something went wrong"}
            </button>
            ) : null}
          </div>
        </main>
      </div>
    );
  }

  if (screen === "completed_confirmed") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.completed_confirmed.support}>
            {localeText.completed_confirmed.title}
          </AgentMessage>
          <button
            className="primary"
            type="button"
            onClick={() => router.push("/")}
          >
            {locale === "es"
              ? "Volver al inicio"
              : "Return to home"}
          </button>
        </main>
      </div>
    );
  }

  if (screen === "completed_auto_closed") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.completed_auto_closed.support}>
            {localeText.completed_auto_closed.title}
          </AgentMessage>
          <button
            className="primary"
            type="button"
            onClick={() => router.push("/")}
          >
            {locale === "es"
              ? "Volver al inicio"
              : "Return to home"}
          </button>
        </main>
      </div>
    );
  }

  if (screen === "cancelled") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.cancelled.support}>
            {localeText.cancelled.title}
          </AgentMessage>
          <button
            className="primary"
            type="button"
            onClick={() => router.push("/")}
          >
            {locale === "es"
              ? "Volver al inicio"
              : "Return to home"}
          </button>
        </main>
      </div>
    );
  }

  if (screen === "no_show") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.no_show?.support || localeText.cancelled.support}>
            {localeText.no_show?.title || (locale === "es" ? "No se presentó" : "Technician did not show")}
          </AgentMessage>
          <button
            className="primary"
            type="button"
            onClick={() => router.push("/")}
          >
            {locale === "es"
              ? "Volver al inicio"
              : "Return to home"}
          </button>
        </main>
      </div>
    );
  }

  if (screen === "disputed") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.disputed.support}>
            {localeText.disputed.title}
          </AgentMessage>
          <button
            className="primary"
            type="button"
            onClick={() => router.push("/")}
          >
            {locale === "es"
              ? "Volver al inicio"
              : "Return to home"}
          </button>
        </main>
      </div>
    );
  }

  return null;
}

function StarRating({
  emptyText,
  label,
  rating,
  starText,
  starsText,
  onChange
}: {
  emptyText: string;
  label: string;
  rating: number | null;
  starText: string;
  starsText: string;
  onChange: (rating: number) => void;
}) {
  return (
    <div className="star-rating" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((value) => {
        const active = rating != null && value <= rating;
        return (
          <button
            aria-checked={rating === value}
            aria-label={`${value} ${value === 1 ? starText : starsText}`}
            className={`star-button ${active ? "active" : ""}`}
            key={value}
            onClick={() => onChange(value)}
            role="radio"
            type="button"
          >
            <Star aria-hidden="true" className="star-icon" fill="currentColor" />
          </button>
        );
      })}
      <p className="star-rating-caption">
        {rating ? `${rating}/5` : emptyText}
      </p>
    </div>
  );
}
