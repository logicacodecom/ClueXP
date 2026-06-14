"use client";

import { useEffect, useState } from "react";
import type { TicketGuards } from "@/types/schema.generated";
import { useRouter, useParams } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";
import { LanguageSelect, useLocale } from "@cluexp/app-core";

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
  role: string;
  rating: number | null;
  eta_min: number;
  eta_max: number;
  eta_is_estimate: boolean;
  assigned_at: string;
  job_status: string;
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
  guards: TicketGuards;
  customer_actions: {
    can_cancel: boolean;
    can_confirm: boolean;
    can_review: boolean;
    can_dispute: boolean;
  };
  terminal: boolean;
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

const DISPATCH_PHONE = process.env.NEXT_PUBLIC_DISPATCH_PHONE || "+18005551234";
const emptyCustomerActions: CustomerActions = {
  can_cancel: false,
  can_confirm: false,
  can_review: false,
  can_dispute: false
};

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

export default function TokenTrackingPage() {
  const router = useRouter();
  const params = useParams();
  const token = params.token as string;
  const { locale } = useLocale();

  const [screen, setScreen] = useState<Screen>("loading");
  const [assignment, setAssignment] = useState<DispatchAssignment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [customerActions, setCustomerActions] = useState<CustomerActions>(emptyCustomerActions);
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [reviewData, setReviewData] = useState<ReviewData>({
    rating: null,
    tags: [],
    comment: ""
  });
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [arrivalPin, setArrivalPin] = useState<string | null>(null);

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
      setAssignment(data.assignment);
      setCustomerActions(data.customer_actions ?? emptyCustomerActions);

      const TERMINAL: Record<string, Screen> = {
        completed_pending_customer: "completed_pending_customer",
        completed_confirmed: "completed_confirmed",
        completed_auto_closed: "completed_auto_closed",
        disputed: "disputed",
        cancelled: "cancelled",
        no_show: "no_show",
      };
      const ACTIVE_LIVE = new Set(["en_route", "arrived", "in_progress"]);

      if (TERMINAL[data.status]) {
        setScreen(TERMINAL[data.status]);
      } else if (ACTIVE_LIVE.has(data.status) && data.guards.may_show_live_tracking) {
        setScreen(data.status as Screen);
      } else if (data.assignment && data.guards.may_show_technician) {
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

  // Load tracking data on mount
  useEffect(() => {
    if (token) {
      void loadTracking();
    }
  }, [token]);

  // Poll for updates
  useEffect(() => {
    if (screen === "waiting" || screen === "matched" || screen === "en_route" || screen === "arrived" || screen === "in_progress") {
      const interval = setInterval(() => {
        void loadTracking();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [screen]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
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

  const handleSubmitReview = async () => {
    if (!reviewData.rating) return;
    
    setBusy(true);
    try {
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
        setBusy(false);
        return;
      }
      
      if (response.status === 403) {
        setError(locale === "es"
          ? "No está autorizado para calificar este trabajo"
          : "Not authorized to review this job");
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
          ? "Error al enviar la reseña"
          : "Error submitting review"));
        setBusy(false);
        return;
      }
      
      setReviewSubmitted(true);
      setScreen("completed_confirmed");
    } catch (err) {
      setError(locale === "es"
        ? "Error de red, intente de nuevo"
        : "Network error, please try again");
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

  const toggleReviewTag = (tag: string) => {
    setReviewData(prev => ({
      ...prev,
      tags: prev.tags.includes(tag) 
        ? prev.tags.filter(t => t !== tag) 
        : [...prev.tags, tag]
    }));
  };

  const renderCancelControl = (withReason: boolean) => {
    if (!customerActions.can_cancel) return null;
    if (!withReason) {
      return (
        <button
          className="ghost"
          type="button"
          onClick={() => void handleCancel()}
        >
          {locale === "es" ? "Cancelar solicitud" : "Cancel request"}
        </button>
      );
    }
    return (
      <div className="panel">
        <p className="panel-title">
          {locale === "es" ? "Cancelar solicitud" : "Cancel request"}
        </p>
        {cancelReasonOpen ? (
          <>
            <textarea
              className="field"
              placeholder={locale === "es" ? "Motivo opcional" : "Optional reason"}
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
            />
            <div className="row">
              <button className="ghost" type="button" onClick={() => setCancelReasonOpen(false)}>
                {locale === "es" ? "Mantener solicitud" : "Keep request"}
              </button>
              <button className="primary" type="button" onClick={() => void handleCancel(cancelReason)}>
                {locale === "es" ? "Confirmar cancelación" : "Confirm cancel"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="fine">
              {locale === "es"
                ? "Puede cancelar antes de que el técnico llegue. Puede agregar un motivo si ayuda al despacho."
                : "You can cancel before the technician arrives. Add a reason if it helps dispatch."}
            </p>
            <button className="ghost" type="button" onClick={() => setCancelReasonOpen(true)}>
              {locale === "es" ? "Cancelar solicitud" : "Cancel request"}
            </button>
          </>
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
            {renderCancelControl(false)}
            <a
              className="ghost"
              href={`tel:${DISPATCH_PHONE}`}
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
          {customerActions.can_cancel && (
            <div className="stack" style={{ marginTop: "2rem" }}>
              {renderCancelControl(true)}
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
            <div className="map" aria-label="Service area map preview" />
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
          </div>
          {customerActions.can_cancel && (
            <div className="stack" style={{ marginTop: "2rem" }}>
              {renderCancelControl(true)}
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
          {assignment && (
            <div className="panel">
              <p className="panel-title">
                {locale === "es" ? "Especialista" : "Specialist"}
              </p>
              <div className="big-number">{assignment.technician_display_name}</div>
              <p className="fine">{assignment.role}</p>
            </div>
          )}
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
                <div className="row" role="radiogroup" aria-label="Service rating">
                {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      className={reviewData.rating === rating ? "primary" : "ghost"}
                      key={rating}
                      type="button"
                      aria-checked={reviewData.rating === rating}
                      role="radio"
                      onClick={() => setReviewData(prev => ({ ...prev, rating }))}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
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
              {customerActions.can_review ? (
                <button
                  className="primary"
                  type="button"
                  disabled={!reviewData.rating}
                  onClick={handleSubmitReview}
                >
                  {locale === "es" ? "Enviar reseña" : "Submit review"}
                </button>
              ) : null}
            </div>
          )}
          <div className="stack">
            {customerActions.can_confirm ? (
              <button
                className="primary"
                type="button"
                onClick={handleConfirm}
              >
                {locale === "es" ? "Confirmar completado" : "Confirm complete"}
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
