import { DispatchPolicySettings } from "@cluexp/console-ui";
import { AppFrame } from "../frame";

export default function SettingsPage() {
  return <AppFrame><div className="space-y-6"><DispatchPolicySettings mode="cluexp" /></div></AppFrame>;
}
