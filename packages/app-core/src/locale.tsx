"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { translateUiText } from "./ui-catalog-es";

export const supportedLocales = ["en", "es"] as const;
export type Locale = (typeof supportedLocales)[number];

const messages = {
  en: {
    language: "Language",
    english: "English",
    spanish: "Spanish",
    save: "Save",
    saving: "Saving...",
    saved: "Saved",
    signIn: "Sign in",
    signUp: "Create account",
    identifier: "Email or phone",
    password: "Password",
    signOut: "Sign out",
    retry: "Try again",
    loading: "Loading...",
    sessionExpired: "Your session expired. Sign in again.",
    unableToConnect: "Unable to connect. Check your connection and try again.",
    jobs: "Jobs",
    active: "Active",
    earnings: "Earnings",
    messages: "Messages",
    profile: "Profile",
    settings: "Settings",
    online: "Online",
    offline: "Offline",
    accept: "Accept",
    decline: "Decline",
    offerExpired: "This offer expired.",
    offerTaken: "Another technician accepted this job.",
    noOffers: "You are online. New offers will appear here.",
    dispatchFeed: "Dispatch feed",
    nearbyWork: "Nearby work",
    pollingLive: "Checking for jobs",
    exactAddressAfterAccept: "Exact address available after acceptance"
  },
  es: {
    language: "Idioma",
    english: "Ingles",
    spanish: "Espanol",
    save: "Guardar",
    saving: "Guardando...",
    saved: "Guardado",
    signIn: "Iniciar sesion",
    signUp: "Crear cuenta",
    identifier: "Correo o telefono",
    password: "Contrasena",
    signOut: "Cerrar sesion",
    retry: "Intentar de nuevo",
    loading: "Cargando...",
    sessionExpired: "Tu sesion vencio. Inicia sesion de nuevo.",
    unableToConnect: "No se pudo conectar. Revisa tu conexion e intenta de nuevo.",
    jobs: "Trabajos",
    active: "Activo",
    earnings: "Ganancias",
    messages: "Mensajes",
    profile: "Perfil",
    settings: "Configuracion",
    online: "En linea",
    offline: "Desconectado",
    accept: "Aceptar",
    decline: "Rechazar",
    offerExpired: "Esta oferta vencio.",
    offerTaken: "Otro tecnico acepto este trabajo.",
    noOffers: "Estas en linea. Las nuevas ofertas apareceran aqui.",
    dispatchFeed: "Ofertas de servicio",
    nearbyWork: "Trabajo cercano",
    pollingLive: "Buscando trabajos",
    exactAddressAfterAccept: "La direccion exacta estara disponible al aceptar"
  }
} as const;

export type MessageKey = keyof (typeof messages)["en"];

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);
const COOKIE_NAME = "cluexp_locale";

function normalizeLocale(value?: string | null): Locale | null {
  const short = value?.toLowerCase().split("-")[0];
  return supportedLocales.includes(short as Locale) ? (short as Locale) : null;
}

function initialLocale(): Locale {
  if (typeof document !== "undefined") {
    const cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${COOKIE_NAME}=`))
      ?.split("=")[1];
    const explicit = normalizeLocale(cookie);
    if (explicit) return explicit;
  }
  if (typeof navigator !== "undefined") {
    for (const language of navigator.languages ?? [navigator.language]) {
      const detected = normalizeLocale(language);
      if (detected) return detected;
    }
  }
  return "en";
}

export function LocaleProvider({ children, persistAuthenticated = false }: { children: ReactNode; persistAuthenticated?: boolean }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    setLocaleState(initialLocale());
    if (persistAuthenticated) {
      void fetch("/api/session", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((body) => {
          const stored = normalizeLocale(body?.session?.user?.locale);
          if (stored) {
            setLocaleState(stored);
            document.cookie = `${COOKIE_NAME}=${stored}; Path=/; Max-Age=31536000; SameSite=Lax`;
          }
        })
        .catch(() => undefined);
    }
  }, [persistAuthenticated]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${COOKIE_NAME}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = next;
    window.localStorage.setItem(COOKIE_NAME, next);
    window.dispatchEvent(new CustomEvent("cluexp:locale", { detail: next }));
    if (persistAuthenticated) {
      void fetch("/api/locale", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: next })
      }).catch(() => undefined);
    }
  }, [persistAuthenticated]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: (key) => messages[locale][key] }),
    [locale, setLocale]
  );
  return (
    <LocaleContext.Provider value={value}>
      <UiTranslationBoundary locale={locale}>{children}</UiTranslationBoundary>
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}

export function LanguageSelect({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <label className={className}>
      <span className="sr-only">{t("language")}</span>
      <select
        aria-label={t("language")}
        className="min-h-11 rounded-md border border-current/20 bg-transparent px-3 text-sm font-semibold"
        onChange={(event) => setLocale(event.target.value as Locale)}
        value={locale}
      >
        <option value="en">{t("english")}</option>
        <option value="es">{t("spanish")}</option>
      </select>
    </label>
  );
}

export function LanguageSettings({ className }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <section className={className}>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{t("language")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Used across this account on supported ClueXP apps.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {supportedLocales.map((item) => (
          <button
            aria-pressed={locale === item}
            className={`min-h-12 rounded-md border px-4 text-left text-sm font-semibold transition-colors ${
              locale === item ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
            key={item}
            onClick={() => setLocale(item)}
            type="button"
          >
            {item === "en" ? t("english") : t("spanish")}
          </button>
        ))}
      </div>
    </section>
  );
}

const translatedAttributes = ["aria-label", "placeholder", "title"] as const;

function UiTranslationBoundary({ children, locale }: { children: ReactNode; locale: Locale }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textState = useRef(new WeakMap<Text, { original: string; rendered: string }>());
  const attributeState = useRef(new WeakMap<Element, Map<string, { original: string; rendered: string }>>());

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function translateTextNode(node: Text) {
      const parent = node.parentElement;
      if (!parent || parent.closest("[data-no-translate],script,style,code,pre")) return;
      const current = node.nodeValue ?? "";
      let state = textState.current.get(node);
      if (!state || current !== state.rendered) {
        state = { original: current, rendered: current };
        textState.current.set(node, state);
      }
      const next = locale === "es" ? translateUiText(state.original) : state.original;
      state.rendered = next;
      if (current !== next) node.nodeValue = next;
    }

    function translateElement(element: Element) {
      if (element.closest("[data-no-translate]")) return;
      let states = attributeState.current.get(element);
      if (!states) {
        states = new Map();
        attributeState.current.set(element, states);
      }
      for (const attribute of translatedAttributes) {
        const current = element.getAttribute(attribute);
        if (current == null) continue;
        let state = states.get(attribute);
        if (!state || current !== state.rendered) {
          state = { original: current, rendered: current };
          states.set(attribute, state);
        }
        const next = locale === "es" ? translateUiText(state.original) : state.original;
        state.rendered = next;
        if (current !== next) element.setAttribute(attribute, next);
      }
    }

    function translateTree(target: Node) {
      if (target.nodeType === Node.TEXT_NODE) {
        translateTextNode(target as Text);
        return;
      }
      if (!(target instanceof Element)) return;
      translateElement(target);
      const walker = document.createTreeWalker(target, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current) {
        if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text);
        else translateElement(current as Element);
        current = walker.nextNode();
      }
    }

    translateTree(root);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") translateTree(mutation.target);
        mutation.addedNodes.forEach((added) => translateTree(added));
      }
    });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [locale]);

  return <div ref={rootRef} style={{ display: "contents" }}>{children}</div>;
}
