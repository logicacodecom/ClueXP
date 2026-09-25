"use client";

import { useEffect, useState } from "react";

export default function VerifyPhonePage() {
  const [message, setMessage] = useState("Verifying your phone…");

  useEffect(() => {
    const token = window.location.hash.slice(1);
    window.history.replaceState({}, "", "/verify");
    if (!token) {
      setMessage("This verification link is invalid or expired.");
      return;
    }
    (async () => {
      try {
        const response = await fetch("/api/phone-verification/consume", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || typeof body.redirect_path !== "string") {
          throw new Error("invalid");
        }
        window.location.replace(body.redirect_path);
      } catch {
        setMessage("This verification link is invalid or expired. Return to your intake and request a new link.");
      }
    })();
  }, []);

  return (
    <main className="shell">
      <section className="card" aria-live="polite">
        <p className="eyebrow">ClueXP verification</p>
        <h1>{message}</h1>
      </section>
    </main>
  );
}
