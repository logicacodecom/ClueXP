import { DispatchPolicySettings } from "@cluexp/console-ui";
import { LanguageSettings } from "@cluexp/app-core";
import { AppFrame } from "../frame";

export default function SettingsPage() {
  return <AppFrame><div className="space-y-6"><LanguageSettings className="rounded-md border border-border bg-card p-6" /><DispatchPolicySettings mode="cluexp" /></div></AppFrame>;
}
