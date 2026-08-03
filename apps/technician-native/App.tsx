import { SafeAreaProvider } from "react-native-safe-area-context";
import { LocaleProvider } from "./src/i18n/LocaleContext";
import { RootApp } from "./src/app/RootApp";

export default function App() {
  return (
    <SafeAreaProvider>
      <LocaleProvider>
        <RootApp />
      </LocaleProvider>
    </SafeAreaProvider>
  );
}
