const LOCALE_KEY = "cluexp.locale";

export async function loadStoredLocale(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LOCALE_KEY);
}

export async function saveStoredLocale(locale: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCALE_KEY, locale);
}
