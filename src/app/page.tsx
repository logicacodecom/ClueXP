"use client";

import { Car, Home, MapPin, Phone, ShieldCheck, Store, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import type { Ticket, TicketEnvelope, TicketGuards } from "@/types/schema.generated";

type Screen =
  | "opener"
  | "situation"
  | "location"
  | "details"
  | "additional"
  | "photos"
  | "identity"
  | "price"
  | "commit"
  | "assigned"
  | "tracking"
  | "arrival"
  | "final"
  | "handoff";

const intakeSteps: Partial<Record<Screen, number>> = {
  opener: 1,
  situation: 2,
  location: 3,
  details: 4,
  additional: 4,
  photos: 4,
  identity: 5,
  price: 5,
  commit: 6,
  handoff: 6
};

const emptyGuards: TicketGuards = {
  may_show_technician: false,
  may_show_eta: false,
  may_show_live_tracking: false
};

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

function money(value?: number | null, currency = "USD") {
  if (value == null) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function TopBar() {
  return (
    <header className="topbar">
      <div className="mark" aria-hidden="true">
        <ShieldCheck size={26} />
      </div>
      <div className="brand">
        <div className="wordmark">ClueXP</div>
        <div className="subtitle">Emergency Access</div>
      </div>
    </header>
  );
}

function StepPipes({ screen }: { screen: Screen }) {
  const step = intakeSteps[screen];
  if (!step) return null;
  return (
    <div className="pipes" aria-label={`Step ${step} of 6`}>
      {Array.from({ length: 6 }).map((_, index) => (
        <span className={`pipe ${index < step ? "on" : ""}`} key={index} />
      ))}
    </div>
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
  return (
    <button className="secondary" type="button" onClick={onClick}>
      <Phone size={18} aria-hidden="true" /> Call a person instead
    </button>
  );
}

function TrustStateGate({
  allow,
  guards,
  children
}: {
  allow: keyof TicketGuards;
  guards: TicketGuards;
  children: React.ReactNode;
}) {
  return guards[allow] ? <>{children}</> : null;
}

function ChipSelect({
  options,
  value,
  onSelect
}: {
  options: { value: string; label: string; hint?: string }[];
  value?: string | null;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="chip-grid">
      {options.map((option) => (
        <button
          className={`chip ${value === option.value ? "active" : ""}`}
          key={option.value}
          type="button"
          onClick={() => onSelect(option.value)}
        >
          {option.label}
          {option.hint ? <span>{option.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

export default function HomePage() {
  const [screen, setScreen] = useState<Screen>("opener");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [guards, setGuards] = useState<TicketGuards>(emptyGuards);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrivalCode, setArrivalCode] = useState("");
  const [form, setForm] = useState({
    address: "",
    make: "",
    model: "",
    year: "",
    lockType: "",
    notes: ""
  });

  const iconFor = useMemo(
    () => ({
      car: <Car size={22} />,
      home: <Home size={22} />,
      business: <Store size={22} />,
      other: <UserRound size={22} />
    }),
    []
  );

  function sync(envelope: TicketEnvelope) {
    setTicket(envelope.ticket);
    setGuards(envelope.guards);
  }

  async function run<T>(work: () => Promise<T>) {
    setBusy(true);
    setError(null);
    try {
      return await work();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function ensureTicket(payload: Record<string, unknown> = {}) {
    if (ticket) return ticket;
    const envelope = await api<TicketEnvelope>("/tickets", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    sync(envelope);
    return envelope.ticket;
  }

  async function patch(payload: Record<string, unknown>) {
    const current = await ensureTicket();
    const envelope = await api<TicketEnvelope>(`/tickets/${current.ticket_id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    sync(envelope);
    return envelope.ticket;
  }

  async function handoff(reason = "explicit") {
    await run(async () => {
      const current = await ensureTicket();
      const envelope = await api<TicketEnvelope>(`/tickets/${current.ticket_id}/handoff`, {
        method: "POST",
        body: JSON.stringify({ reason })
      });
      sync(envelope);
      setScreen("handoff");
    });
  }

  const content = (() => {
    if (screen === "opener") {
      return (
        <>
          <AgentMessage support="A few structured answers help us route the right access specialist without inventing details.">
            What are you locked out of?
          </AgentMessage>
          <div className="stack">
            {[
              ["car", "Car", "Keys, fob, or vehicle entry"],
              ["home", "Home", "House, apartment, or rental"],
              ["business", "Business", "Storefront, office, or facility"],
              ["other", "Something else", "Talk with a person"]
            ].map(([value, label, hint]) => (
              <button
                className="choice"
                key={value}
                type="button"
                onClick={() =>
                  run(async () => {
                    const envelope = await api<TicketEnvelope>("/tickets", {
                      method: "POST",
                      body: JSON.stringify({ access_type: value })
                    });
                    sync(envelope);
                    if (value === "other") {
                      await handoff("unresolvable");
                    } else {
                      setScreen("situation");
                    }
                  })
                }
              >
                <span style={{ color: "var(--text)", display: "inline-flex", gap: 10, alignItems: "center" }}>
                  {iconFor[value as keyof typeof iconFor]} {label}
                </span>
                <span>{hint}</span>
              </button>
            ))}
          </div>
        </>
      );
    }

    if (screen === "situation") {
      return (
        <>
          <AgentMessage>Which situation fits best?</AgentMessage>
          <ChipSelect
            value={ticket?.situation}
            options={[
              { value: "locked_out", label: "Locked out" },
              { value: "lost_key", label: "Lost key" },
              { value: "broken_key", label: "Broken key" },
              { value: "key_in_car", label: "Key in car" },
              { value: "malfunction", label: "Lock or key malfunction" },
              { value: "rekey", label: "Need a rekey" }
            ]}
            onSelect={(value) =>
              run(async () => {
                await patch({ situation: value });
                setScreen("location");
              })
            }
          />
        </>
      );
    }

    if (screen === "location") {
      return (
        <>
          <AgentMessage support="Use GPS if you can. A typed address is fine too.">
            Where should help go?
          </AgentMessage>
          <div className="stack">
            <button
              className="primary"
              type="button"
              onClick={() =>
                run(async () => {
                  await patch({ location: { raw_text: "Current GPS location", lat: 40.7128, lng: -74.006, geocode_confidence: "high" } });
                })
              }
            >
              <MapPin size={18} /> Share GPS
            </button>
            <input
              className="field"
              placeholder="Address or nearby landmark"
              value={form.address}
              onChange={(event) => setForm({ ...form, address: event.target.value })}
            />
            <div className="panel">
              <p className="panel-title">Safety check</p>
              <ChipSelect
                value={ticket?.safety_flag?.type}
                options={[
                  { value: "none", label: "Everyone is safe" },
                  { value: "person_inside", label: "Person inside" },
                  { value: "pet_inside", label: "Pet inside" },
                  { value: "medical", label: "Medical concern" },
                  { value: "unsafe_location", label: "I feel unsafe here" }
                ]}
                onSelect={(value) =>
                  run(async () => {
                    await patch({
                      location: { raw_text: form.address || ticket?.location?.raw_text || "Address pending" },
                      safety_flag: { present: value !== "none", type: value, advised_emergency_services: value !== "none" }
                    });
                    if (value !== "none") await handoff("safety");
                    else setScreen("details");
                  })
                }
              />
            </div>
          </div>
        </>
      );
    }

    if (screen === "details") {
      const isCar = ticket?.access_type === "car";
      return (
        <>
          <AgentMessage>{isCar ? "Tell us about the vehicle." : "Tell us about the lock."}</AgentMessage>
          <div className="stack">
            {isCar ? (
              <>
                <input className="field" placeholder="Make" value={form.make} onChange={(event) => setForm({ ...form, make: event.target.value })} />
                <input className="field" placeholder="Model" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
                <input className="field" inputMode="numeric" placeholder="Year" value={form.year} onChange={(event) => setForm({ ...form, year: event.target.value })} />
                <ChipSelect
                  value={ticket?.automotive?.key_type}
                  options={[
                    { value: "mechanical", label: "Mechanical key" },
                    { value: "transponder", label: "Transponder" },
                    { value: "smart_key", label: "Smart key or fob" },
                    { value: "unknown", label: "Not sure", hint: "That is okay" }
                  ]}
                  onSelect={(value) =>
                    run(async () => {
                      await patch({
                        automotive: {
                          make: form.make || null,
                          model: form.model || null,
                          year: form.year ? Number(form.year) : null,
                          key_type: value,
                          key_type_source: "stated"
                        }
                      });
                      setScreen("additional");
                    })
                  }
                />
              </>
            ) : (
              <>
                <input className="field" placeholder="Lock type, if known" value={form.lockType} onChange={(event) => setForm({ ...form, lockType: event.target.value })} />
                <button
                  className="primary"
                  type="button"
                  onClick={() =>
                    run(async () => {
                      await patch({ property: { lock_type: form.lockType || null } });
                      setScreen("additional");
                    })
                  }
                >
                  Continue
                </button>
              </>
            )}
          </div>
        </>
      );
    }

    if (screen === "additional") {
      return (
        <>
          <AgentMessage support="Notes are optional. Skip has the same weight here.">
            Anything else we should know?
          </AgentMessage>
          <div className="stack">
            <textarea className="field" placeholder="Gate code, parking note, lock detail" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            <div className="row">
              <button className="ghost" type="button" onClick={() => setScreen("photos")}>Skip</button>
              <button className="primary" type="button" onClick={() => run(async () => { await patch({ additional_details: form.notes || null }); setScreen("photos"); })}>Continue</button>
            </div>
          </div>
        </>
      );
    }

    if (screen === "photos") {
      return (
        <>
          <AgentMessage support="Photos can help, but they never block dispatch.">
            Add a photo if it is useful.
          </AgentMessage>
          <div className="stack">
            <input className="field" type="file" accept="image/*" multiple />
            <div className="row">
              <button className="ghost" type="button" onClick={() => setScreen("identity")}>Skip</button>
              <button className="primary" type="button" onClick={() => setScreen("identity")}>Continue</button>
            </div>
          </div>
        </>
      );
    }

    if (screen === "identity") {
      return (
        <>
          <AgentMessage support="The specialist will verify ID or authority at arrival.">
            Can you confirm this is yours or you are authorized?
          </AgentMessage>
          <ChipSelect
            value={ticket?.identity?.authority_role}
            options={[
              { value: "owner", label: "Owner" },
              { value: "tenant", label: "Tenant" },
              { value: "manager", label: "Manager" },
              { value: "employee", label: "Employee" },
              { value: "other", label: "Other authorized person" }
            ]}
            onSelect={(value) => run(async () => { await patch({ identity: { claims_ownership: true, authority_role: value } }); setScreen("price"); })}
          />
        </>
      );
    }

    if (screen === "price") {
      const quote = ticket?.price_quote;
      const policy = ticket?.cancellation_policy;
      return (
        <>
          <AgentMessage support="This is the first commercial consent step. No technician is committed before you accept.">
            Review the estimate and cancellation policy.
          </AgentMessage>
          <div className="stack">
            {!quote ? (
              <button className="primary" type="button" onClick={() => run(async () => { const current = await ensureTicket(); sync(await api<TicketEnvelope>(`/tickets/${current.ticket_id}/price-quote`, { method: "POST" })); })}>
                Get estimate
              </button>
            ) : (
              <>
                <div className="panel">
                  <p className="panel-title">Estimated range</p>
                  <div className="big-number">{money(quote.estimate_min, quote.currency)} - {money(quote.estimate_max, quote.currency)}</div>
                </div>
                <div className="panel">
                  <p className="panel-title">Cancellation policy</p>
                  <p className="fine">Free before assignment. After assignment: {money(policy?.cancellation_fee, policy?.currency)} cancellation fee. No-show fee: {money(policy?.no_show_fee, policy?.currency)}.</p>
                </div>
                <button
                  className="primary"
                  type="button"
                  onClick={() =>
                    run(async () => {
                      await patch({
                        price_quote: { accepted_by_customer: true, accepted_at: new Date().toISOString() },
                        cancellation_policy: { accepted_by_customer: true, accepted_at: new Date().toISOString() }
                      });
                      setScreen("commit");
                    })
                  }
                >
                  Accept estimate and request terms
                </button>
              </>
            )}
          </div>
        </>
      );
    }

    if (screen === "commit") {
      return (
        <>
          <AgentMessage support="This commits your request and matches a specialist. Technician details appear only after the backend assigns someone.">
            Ready to request help?
          </AgentMessage>
          <button
            className="primary"
            type="button"
            onClick={() =>
              run(async () => {
                const current = await ensureTicket();
                await api<TicketEnvelope>(`/tickets/${current.ticket_id}/commit`, { method: "POST" });
                sync(await api<TicketEnvelope>(`/tickets/${current.ticket_id}/dispatch`, { method: "POST" }));
                setScreen("assigned");
              })
            }
          >
            Confirm request
          </button>
        </>
      );
    }

    if (screen === "assigned") {
      return (
        <>
          <AgentMessage support="The assignment below is returned by dispatch.">
            A verified specialist is assigned.
          </AgentMessage>
          <TrustStateGate allow="may_show_technician" guards={guards}>
            <div className="panel">
              <p className="panel-title">Specialist</p>
              <div className="big-number">{ticket?.technician_assignment?.display_name}</div>
              <p className="fine">{ticket?.technician_assignment?.role} {ticket?.technician_assignment?.rating ? `- ${ticket.technician_assignment.rating} rating` : ""}</p>
              <TrustStateGate allow="may_show_eta" guards={guards}>
                <p className="fine">ETA {ticket?.technician_assignment?.eta_minutes_min}-{ticket?.technician_assignment?.eta_minutes_max} minutes.</p>
              </TrustStateGate>
            </div>
          </TrustStateGate>
          <button className="primary" type="button" onClick={() => run(async () => { const current = await ensureTicket(); sync(await api<TicketEnvelope>(`/tickets/${current.ticket_id}/tracking`)); setScreen("tracking"); })}>Open live tracking</button>
        </>
      );
    }

    if (screen === "tracking") {
      return (
        <>
          <AgentMessage support="Keep this page open for live updates.">
            Specialist en route.
          </AgentMessage>
          <TrustStateGate allow="may_show_live_tracking" guards={guards}>
            <div className="stack">
              <div className="map" aria-label="Static placeholder map with route lines" />
              <div className="panel">
                <p className="panel-title">ETA</p>
                <div className="big-number">{ticket?.technician_assignment?.eta_minutes_min}-{ticket?.technician_assignment?.eta_minutes_max} min</div>
              </div>
              <button className="primary" type="button" onClick={() => run(async () => { const current = await ensureTicket(); const result = await api<{ customer_code: string }>(`/tickets/${current.ticket_id}/arrival-handshake`, { method: "POST", body: JSON.stringify({}) }); setArrivalCode(result.customer_code); setScreen("arrival"); })}>Arrival verification</button>
            </div>
          </TrustStateGate>
        </>
      );
    }

    if (screen === "arrival") {
      return (
        <>
          <AgentMessage support="The specialist should present the matching verification before work begins.">
            Confirm arrival together.
          </AgentMessage>
          <div className="panel">
            <p className="panel-title">Customer code</p>
            <div className="big-number">{arrivalCode}</div>
            <p className="fine">Ask the specialist to show the same code.</p>
          </div>
          <button className="primary" type="button" onClick={() => run(async () => { const current = await ensureTicket(); sync(await api<TicketEnvelope>(`/tickets/${current.ticket_id}/finalize`, { method: "POST" })); setScreen("final"); })}>Continue to payment</button>
        </>
      );
    }

    if (screen === "final") {
      const quote = ticket?.price_quote;
      const final = ticket?.final_charge;
      return (
        <>
          <AgentMessage support="Review the completed service before capture.">
            Payment and review.
          </AgentMessage>
          <div className="stack">
            <div className="row">
              <div className="panel">
                <p className="panel-title">Estimate</p>
                <div>{money(quote?.estimate_min, quote?.currency)} - {money(quote?.estimate_max, quote?.currency)}</div>
              </div>
              <div className="panel">
                <p className="panel-title">Final</p>
                <div>{money(final?.final_amount, final?.currency)}</div>
              </div>
            </div>
            {final?.customer_approval_required && !final.customer_approved ? (
              <button className="primary" type="button" onClick={() => run(async () => { const current = await ensureTicket(); sync(await api<TicketEnvelope>(`/tickets/${current.ticket_id}/approve-final`, { method: "POST" })); })}>Approve final price</button>
            ) : (
              <button className="primary" type="button" onClick={() => run(async () => { const current = await ensureTicket(); await api(`/tickets/${current.ticket_id}/charge`, { method: "POST" }); })}>Capture payment</button>
            )}
            <button className="ghost" type="button">Add to Home Screen</button>
          </div>
        </>
      );
    }

    return (
      <>
        <AgentMessage support="We are connecting you to a person who can help faster from here.">
          A dispatcher can take over.
        </AgentMessage>
        <div className="panel">
          <p className="panel-title">Dispatcher</p>
          <div className="big-number">Sam Reyes</div>
          <p className="fine">Plain-language support for this request. No app install required.</p>
        </div>
        <button className="primary" type="button">Call now</button>
      </>
    );
  })();

  return (
    <div className="shell">
      <TopBar />
      <main className="main">
        <StepPipes screen={screen} />
        {content}
        {busy ? <p className="fine">Working...</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <CallAPersonButton onClick={() => handoff("explicit")} />
        </div>
      </footer>
    </div>
  );
}
