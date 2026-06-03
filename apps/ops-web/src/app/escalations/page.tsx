import { EscalationQueue } from "@cluexp/console-ui";
import { AppFrame } from "../frame";

export default function EscalationsPage() {
  return <AppFrame><EscalationQueue mode="cluexp" /></AppFrame>;
}
