import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { translateUiText } from "./dictionary";
import { loadStoredLocale, saveStoredLocale } from "./localeStore";

export type Locale = "en" | "es";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (text: string) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    void loadStoredLocale().then((stored) => {
      if (stored === "es" || stored === "en") setLocaleState(stored);
    });
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale: (next) => {
      setLocaleState(next);
      void saveStoredLocale(next);
    },
    t: (text) => (locale === "es" ? translateUiText(text) : text)
  }), [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used within LocaleProvider");
  return value;
}
