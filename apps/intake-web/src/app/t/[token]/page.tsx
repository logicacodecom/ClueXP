"use client";

import { useEffect, useState } from "react";
import type { Ticket, TicketGuards } from "@/types/schema.generated";
import { useRouter, useParams } from "next/navigation";
import { Car, Clock3, LoaderCircle, MapPin, Phone, ShieldCheck, UserRound } from "lucide-react";
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
  can_confirm: boolean;
  can_review: boolean;
  can_dispute: boolean;
  terminal: boolean;
}

interface ReviewData {
  rating: number | null;
  tags: string[];
  comment: string;
}

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

function CallAPersonButton({ onClick }: { onClick: () => void }) {
  const { locale } = useLocale();
  return (
    <button className="secondary" type="button" onClick={onClick}>
      <Phone size={18} aria-hidden="true" />
      {locale === "es" ? "Llamar a una persona" : "Call a person instead"}
    </button>
  );
}

function StatusPill({ status }: { status: Screen }) {
  const labels = {
    loading: "Loading",
    waiting: "Waiting",
    matched: "Assigned",
    en_route: "En Route",
    arrived: "Arrived",
    in_progress: "In Progress",
    completed_pending_customer: "Complete",
    completed_confirmed: "Completed",
    completed_auto_closed: "Closed",
    disputed: "In Review",
    cancelled: "Cancelled",
    error: "Error",
  };

  const tones = {
    loading: "default",
    waiting: "default",
    matched: "success",
    en_route: "success",
    arrived: "success",
    in_progress: "success",
    completed_pending_customer: "success",
    completed_confirmed: "success",
    completed_auto_closed: "default",
    disputed: "warn",
    cancelled: "default",
    error: "error",
  };

  const label = labels[status] || status;
  const tone = tones[status as keyof typeof tones] || "default";

  return (
    <span className={`pill pill--${tone}`}>
      {label}
    </span>
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
  const [reviewData, setReviewData] = useState<ReviewData>({
    rating: null,
    tags: [],
    comment: ""
  });
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [arrivalCode, setArrivalCode] = useState("");

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
        ? "Verifica el código de llegada antes de que comience el trabajo."
        : "Verify the arrival code before work begins."
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
    }
  };

  const loadTracking = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await api<TrackingResponse>(`/t/${token}`);
      setAssignment(data.assignment);
      
      if (data.guards.may_show_technician && data.guards.may_show_live_tracking) {
        if (data.status === "completed_pending_customer") {
          setScreen("completed_pending_customer");
        } else if (data.status === "completed_confirmed") {
          setScreen("completed_confirmed");
        } else if (data.status === "completed_auto_closed") {
          setScreen("completed_auto_closed");
        } else if (data.status === "disputed") {
          setScreen("disputed");
        } else if (data.status === "cancelled" || data.status === "no_show") {
          setScreen("cancelled");
        } else if (data.assignment) {
          setScreen("matched");
        } else {
          setScreen("waiting");
        }
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
      await api(`/t/${token}/confirm`, { method: "POST" });
      setScreen("completed_confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm completion");
    } finally {
      setBusy(false);
    }
  };

  const handleDispute = async () => {
    setBusy(true);
    try {
      await api(`/t/${token}/dispute`, { method: "POST" });
      setScreen("disputed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to report issue");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!reviewData.rating) return;
    
    setBusy(true);
    try {
      await api(`/t/${token}/review`, {
        method: "POST",
        body: JSON.stringify({
          rating: reviewData.rating,
          tags: reviewData.tags,
          comment: reviewData.comment || null
        })
      });
      setReviewSubmitted(true);
      await handleConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit review");
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
          <button 
            className="primary" 
            type="button" 
            onClick={() => setScreen("en_route")}
          >
            {locale === "es" 
              ? localeText.en_route.title 
              : localeText.en_route.title}
          </button>
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
            <button 
              className="primary" 
              type="button" 
              onClick={() => setScreen("arrived")}
            >
              {locale === "es" 
                ? localeText.arrived.title 
                : localeText.arrived.title}
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (screen === "arrived") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText.arrived.support}>
            {localeText.arrived.title}
          </AgentMessage>
          <div className="panel">
            <p className="panel-title">
              {locale === "es" 
                ? "Código de cliente" 
                : "Customer code"}
            </p>
            <div className="big-number">{arrivalCode || "####"}</div>
            <p className="fine">
              {locale === "es"
                ? "Pídale al especialista que muestre el mismo código."
                : "Ask the specialist to show the same code."}
            </p>
          </div>
          <button 
            className="primary" 
            type="button" 
            onClick={() => setScreen("in_progress")}
          >
            {locale === "es" 
              ? localeText.in_progress.title 
              : localeText.in_progress.title}
          </button>
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
          <button 
            className="primary" 
            type="button" 
            onClick={() => setScreen("completed_pending_customer")}
          >
            {locale === "es" 
              ? localeText.completed_pending_customer.title 
              : localeText.completed_pending_customer.title}
          </button>
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
              <button
                className="primary"
                type="button"
                disabled={!reviewData.rating}
                onClick={handleSubmitReview}
              >
                {locale === "es" ? "Enviar reseña" : "Submit review"}
              </button>
            </div>
          )}
          <div className="stack">
            <button 
              className="ghost" 
              type="button" 
              onClick={handleDispute}
            >
              {locale === "es" 
                ? localeText.disputed.title 
                : localeText.disputed.title}
            </button>
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

  if (screen === "completed_auto_closed" || screen === "cancelled" || screen === "disputed") {
    return (
      <div className="shell">
        <TopBar />
        <main className="main">
          <AgentMessage support={localeText[screen as keyof typeof localeText]?.support}>
            {localeText[screen as keyof typeof localeText]?.title}
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
