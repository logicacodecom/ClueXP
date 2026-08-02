import * as SecureStore from "expo-secure-store";

const LOCALE_KEY = "cluexp.locale";

export async function loadStoredLocale(): Promise<string | null> {
  return SecureStore.getItemAsync(LOCALE_KEY);
}

export async function saveStoredLocale(locale: string) {
  await SecureStore.setItemAsync(LOCALE_KEY, locale);
}
