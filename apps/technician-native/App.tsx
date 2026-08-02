import { LocaleProvider } from "./src/i18n/LocaleContext";
import { RootApp } from "./src/app/RootApp";

export default function App() {
  return (
    <LocaleProvider>
      <RootApp />
    </LocaleProvider>
  );
}
